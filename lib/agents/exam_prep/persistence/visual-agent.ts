import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import type { LearningOutcome } from "@/lib/agents/exam_prep/alignment-types";
import {
  buildFigureRichEmbeddingText,
  buildRichEmbeddingText,
  labelExamPrepChunk,
  labelExamPrepQuestionFigure,
} from "@/lib/agents/exam_prep/persistence/label-rich";
import type {
  PdfPersistenceStats,
  PersistContentRole,
} from "@/lib/agents/exam_prep/persistence/types";
import type {
  ExamPrepCurriculum,
  StudentPdfInput,
} from "@/lib/agents/exam_prep/types";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import { AGENT_CHAT_MODEL } from "@/lib/agents/config";
import { EXAM_PREP_VISION_BATCH_SIZE, EXAM_PREP_VISION_PAGE_CONCURRENCY } from "@/lib/exam-prep/constants";
import { chunkPagesToRawText } from "@/lib/yks-chunks/chunking";
import type { YksChunkType } from "@/lib/yks-chunks/types";
import { insertYksChunkRecord } from "@/lib/yks-chunks/repository";
import type { LoadedPdfPage } from "@/lib/academic-ingestion/types";
import { processQuestionPage } from "@/lib/yks-figures/process-question-page";
import { createYksFigureEmbedding } from "@/lib/yks-figures/embed";
import { insertYksFigureRecord } from "@/lib/yks-figures/repository";
import {
  buildYksFigureStoragePath,
  uploadYksFigureToStorage,
} from "@/lib/yks-figures/storage";

const MATERIAL_OCR_SYSTEM = `Sen taranmış YKS ders kitabı / konu anlatımı OCR uzmanısın.
Sayfa görselindeki TÜM eğitim metnini oku ve JSON döndür.

Yanıt:
{
  "pages": [
    { "page_number": 1, "text": "Sayfadaki tam metin..." }
  ]
}

Kurallar:
- Başlık, paragraf, madde işaretleri korunmalı
- Sayfa numarası, logo, dekoratif öğeleri atla
- Metin yoksa text: ""`;

const CURRICULUM_OCR_SYSTEM = `Sen taranmış RESMİ SINAV MÜFREDATI / KAZANIM LİSTESİ OCR uzmanısın.
Sayfa görselindeki müfredat metnini, ünite başlıklarını ve kazanım maddelerini oku.

Yanıt:
{
  "pages": [
    { "page_number": 1, "text": "Ünite, tema ve kazanım metinleri..." }
  ]
}

Kurallar:
- Kazanım kodları ve madde numaralarını koru
- Tablo yapısını okunabilir metne çevir
- Sayfa numarası, logo atla
- Metin yoksa text: ""`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Vision OCR yanıtı JSON değil.");
  }
}

function chunkVisionPages<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function extractTextFromVision(
  openai: OpenAI,
  pdf: StudentPdfInput,
  ocrSystemPrompt: string,
): Promise<LoadedPdfPage[]> {
  const pageImages = pdf.pageImages ?? [];
  if (!pageImages.length) return [];

  const batches = chunkVisionPages(pageImages, EXAM_PREP_VISION_BATCH_SIZE);
  const pages: LoadedPdfPage[] = [];

  for (const batch of batches) {
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      {
        type: "text",
        text: `Kaynak: ${pdf.fileName}\nSayfalar: ${batch.map((p) => p.pageNumber).join(", ")}`,
      },
      ...batch.map((page) => ({
        type: "image_url" as const,
        image_url: {
          url: `data:image/png;base64,${page.pngBase64}`,
          detail: "high" as const,
        },
      })),
    ];

    const completion = await openai.chat.completions.create(
      buildChatCompletionParams(
        AGENT_CHAT_MODEL,
        [
          { role: "system", content: ocrSystemPrompt },
          { role: "user", content: userContent },
        ],
        { temperature: 0.1, responseFormat: { type: "json_object" } },
      ),
    );

    const rawText = completion.choices[0]?.message?.content?.trim();
    if (!rawText) continue;

    const parsed = extractJson(rawText) as Record<string, unknown>;
    const rows = Array.isArray(parsed.pages) ? parsed.pages : [];

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      const text = String(record.text ?? "").trim();
      const pageNumber = Number(record.page_number ?? record.pageNumber ?? 0);
      if (!text || !pageNumber) continue;

      pages.push({
        pageNumber,
        textLayer: text,
        width: 0,
        height: 0,
      });
    }
  }

  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

async function storeLabeledChunk(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    labeled: Awaited<ReturnType<typeof labelExamPrepChunk>>;
    fileName: string;
    pageStart: number;
    pageEnd: number;
  },
): Promise<void> {
  const embeddingResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: buildRichEmbeddingText(options.labeled),
  });
  const embedding = embeddingResponse.data[0]?.embedding;
  if (!embedding?.length) {
    throw new Error("Chunk embedding oluşturulamadı.");
  }

  await insertYksChunkRecord(supabase, {
    chunk: {
      chunkType: options.labeled.chunkType as YksChunkType,
      subject: options.labeled.subject,
      curriculum: options.labeled.curriculum as "genel",
      topic: options.labeled.topic,
      subtopic: options.labeled.subtopic,
      content: options.labeled.content,
      difficulty: options.labeled.difficulty,
    },
    embedding,
    sourceName: options.fileName.replace(/\.pdf$/i, ""),
    sourcePdf: options.fileName,
    pageStart: options.pageStart,
    pageEnd: options.pageEnd,
    metadata: options.labeled.rich as unknown as Record<string, unknown>,
  });
}

/** Taranmış metin PDF: vision OCR → chunk → Supabase */
async function runVisionOcrAndPersist(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    pdf: StudentPdfInput;
    ownerUserId: string;
    examGoal: string;
    hintSubject?: string | null;
    hintCurriculum?: ExamPrepCurriculum | null;
    hintOutcomes?: LearningOutcome[];
    role: PersistContentRole;
    ocrSystemPrompt: string;
  },
): Promise<PdfPersistenceStats> {
  const stats: PdfPersistenceStats = {
    pdfId: options.pdf.id,
    fileName: options.pdf.fileName,
    role: options.role,
    mode: "vision",
    storedChunks: 0,
    storedFigures: 0,
    skipped: 0,
    errors: [],
  };

  try {
    const pages = await extractTextFromVision(
      openai,
      options.pdf,
      options.ocrSystemPrompt,
    );
    if (!pages.length) {
      stats.errors.push("Vision OCR metin çıkaramadı.");
      return stats;
    }

    const rawChunks = chunkPagesToRawText(pages);

    for (const raw of rawChunks) {
      try {
        const labeled = await labelExamPrepChunk(openai, raw.text, {
          role: options.role,
          fileName: options.pdf.fileName,
          pdfId: options.pdf.id,
          ownerUserId: options.ownerUserId,
          pageStart: raw.pageStart,
          pageEnd: raw.pageEnd,
          hintSubject: options.hintSubject,
          hintCurriculum: options.hintCurriculum,
          hintOutcomes: options.hintOutcomes,
          examGoal: options.examGoal,
        });

        await storeLabeledChunk(supabase, openai, {
          labeled,
          fileName: options.pdf.fileName,
          pageStart: raw.pageStart,
          pageEnd: raw.pageEnd,
        });
        stats.storedChunks += 1;
      } catch (error) {
        stats.skipped += 1;
        stats.errors.push(
          error instanceof Error
            ? error.message
            : `${options.role} vision chunk kayıt hatası`,
        );
      }
    }
  } catch (error) {
    stats.errors.push(
      error instanceof Error
        ? error.message
        : `${options.role} vision agent hatası`,
    );
  }

  return stats;
}

/** Taranmış konu PDF: vision OCR → metin chunk → Supabase */
export async function runVisualAgentForMaterial(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    pdf: StudentPdfInput;
    ownerUserId: string;
    examGoal: string;
    hintSubject?: string | null;
    hintCurriculum?: ExamPrepCurriculum | null;
    hintOutcomes?: LearningOutcome[];
  },
): Promise<PdfPersistenceStats> {
  return runVisionOcrAndPersist(supabase, openai, {
    ...options,
    role: "material",
    ocrSystemPrompt: MATERIAL_OCR_SYSTEM,
  });
}

/** Taranmış müfredat PDF: vision OCR → müfredat chunk → Supabase */
export async function runVisualAgentForCurriculum(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    pdf: StudentPdfInput;
    ownerUserId: string;
    examGoal: string;
    hintSubject?: string | null;
    hintCurriculum?: ExamPrepCurriculum | null;
    hintOutcomes?: LearningOutcome[];
  },
): Promise<PdfPersistenceStats> {
  return runVisionOcrAndPersist(supabase, openai, {
    ...options,
    role: "curriculum",
    ocrSystemPrompt: CURRICULUM_OCR_SYSTEM,
  });
}

/** Taranmış soru PDF: kutula → kes → Supabase (yks_figures) */
export async function runVisualAgentForQuestions(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    pdf: StudentPdfInput;
    ownerUserId: string;
    examGoal: string;
    hintSubject?: string | null;
    hintCurriculum?: ExamPrepCurriculum | null;
    hintOutcomes?: LearningOutcome[];
  },
): Promise<PdfPersistenceStats> {
  const stats: PdfPersistenceStats = {
    pdfId: options.pdf.id,
    fileName: options.pdf.fileName,
    role: "question",
    mode: "vision",
    storedChunks: 0,
    storedFigures: 0,
    skipped: 0,
    errors: [],
  };

  const pageImages = options.pdf.pageImages ?? [];
  const sourceName = options.pdf.fileName.replace(/\.pdf$/i, "");

  const pageResults = await mapWithConcurrency(
    pageImages,
    EXAM_PREP_VISION_PAGE_CONCURRENCY,
    async (page) => {
      const pagePng = Buffer.from(page.pngBase64, "base64");
      if (!pagePng.length) {
        return { pageNumber: page.pageNumber, crops: [], errors: [] as string[] };
      }

      const result = await processQuestionPage(openai, pagePng, {
        fileName: options.pdf.fileName,
        pageNumber: page.pageNumber,
      });

      return {
        pageNumber: page.pageNumber,
        crops: result.crops,
        errors: result.errors,
      };
    },
  );

  for (const pageResult of pageResults) {
    if (pageResult.errors.length) {
      stats.skipped += 1;
      stats.errors.push(...pageResult.errors);
    }

    let figureIndex = 0;
    for (const crop of pageResult.crops) {
      try {
        const labels = await labelExamPrepQuestionFigure(openai, {
          textPreview: crop.textPreview,
          fileName: options.pdf.fileName,
          pdfId: options.pdf.id,
          ownerUserId: options.ownerUserId,
          pageNumber: pageResult.pageNumber,
          hintSubject: options.hintSubject,
          hintCurriculum: options.hintCurriculum,
          hintOutcomes: options.hintOutcomes,
          examGoal: options.examGoal,
          imageBase64: crop.buffer.toString("base64"),
        });

        const storagePath = buildYksFigureStoragePath({
          pdfFileName: options.pdf.fileName,
          pageNumber: pageResult.pageNumber,
          figureIndex: figureIndex++,
        });

        const publicUrl = await uploadYksFigureToStorage(
          supabase,
          storagePath,
          crop.buffer,
        );

        const embedding = await createYksFigureEmbedding(
          openai,
          buildFigureRichEmbeddingText({
            caption: labels.caption,
            topic: labels.topic,
            subject: labels.subject,
            curriculum: labels.curriculum,
            rich: labels.rich,
          }),
        );

        await insertYksFigureRecord(supabase, {
          figureType: "question",
          subject: labels.subject,
          curriculum: labels.curriculum,
          topic: labels.topic,
          caption: labels.caption,
          storagePath,
          publicUrl,
          sourcePdf: options.pdf.fileName,
          sourceName,
          pageNumber: pageResult.pageNumber,
          bbox: crop.bbox,
          width: crop.width,
          height: crop.height,
          embedding,
          metadata: {
            ...(labels.rich as unknown as Record<string, unknown>),
            ...(crop.cropRevision ? { cropRevision: crop.cropRevision } : {}),
          },
        });

        stats.storedFigures += 1;
      } catch (error) {
        stats.skipped += 1;
        stats.errors.push(
          error instanceof Error
            ? `s.${pageResult.pageNumber} soru kayıt: ${error.message}`
            : `s.${pageResult.pageNumber} soru kaydedilemedi`,
        );
      }
    }
  }

  return stats;
}
