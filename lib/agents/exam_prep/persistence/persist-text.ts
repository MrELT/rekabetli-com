import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import type { LearningOutcome } from "@/lib/agents/exam_prep/alignment-types";
import {
  buildRichEmbeddingText,
  labelExamPrepChunk,
} from "@/lib/agents/exam_prep/persistence/label-rich";
import { chunkPagesToQuestions } from "@/lib/agents/exam_prep/persistence/question-chunking";
import type {
  PdfPersistenceStats,
  PersistContentRole,
} from "@/lib/agents/exam_prep/persistence/types";
import type {
  ExamPrepCurriculum,
  StudentPdfInput,
} from "@/lib/agents/exam_prep/types";
import { EXAM_PREP_PERSIST_CONCURRENCY } from "@/lib/exam-prep/constants";
import { loadPdfPages } from "@/lib/pdf-page-render";
import { chunkPagesToRawText } from "@/lib/yks-chunks/chunking";
import { insertYksChunkRecord } from "@/lib/yks-chunks/repository";
import type { RawTextChunk, YksChunkType } from "@/lib/yks-chunks/types";

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

async function persistRawChunks(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    role: PersistContentRole;
    pdf: StudentPdfInput;
    ownerUserId: string;
    examGoal: string;
    rawChunks: RawTextChunk[];
    hintSubject?: string | null;
    hintCurriculum?: ExamPrepCurriculum | null;
    hintOutcomes?: LearningOutcome[];
  },
): Promise<PdfPersistenceStats> {
  const stats: PdfPersistenceStats = {
    pdfId: options.pdf.id,
    fileName: options.pdf.fileName,
    role: options.role,
    mode: "text",
    storedChunks: 0,
    storedFigures: 0,
    skipped: 0,
    errors: [],
  };

  await mapWithConcurrency(
    options.rawChunks,
    EXAM_PREP_PERSIST_CONCURRENCY,
    async (raw) => {
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

        const embeddingResponse = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: buildRichEmbeddingText(labeled),
        });
        const embedding = embeddingResponse.data[0]?.embedding;
        if (!embedding?.length) {
          throw new Error("Embedding oluşturulamadı.");
        }

        await insertYksChunkRecord(supabase, {
          chunk: {
            chunkType: labeled.chunkType as YksChunkType,
            subject: labeled.subject,
            curriculum: labeled.curriculum as "genel",
            topic: labeled.topic,
            subtopic: labeled.subtopic,
            content: labeled.content,
            difficulty: labeled.difficulty,
          },
          embedding,
          sourceName: options.pdf.fileName.replace(/\.pdf$/i, ""),
          sourcePdf: options.pdf.fileName,
          pageStart: raw.pageStart,
          pageEnd: raw.pageEnd,
          metadata: labeled.rich as unknown as Record<string, unknown>,
        });

        stats.storedChunks += 1;
      } catch (error) {
        stats.skipped += 1;
        stats.errors.push(
          error instanceof Error
            ? `s.${raw.pageStart}: ${error.message}`
            : `s.${raw.pageStart}: kayıt hatası`,
        );
      }
    },
  );

  return stats;
}

export async function persistTextMaterialPdf(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    pdf: StudentPdfInput;
    buffer: Buffer;
    ownerUserId: string;
    examGoal: string;
    maxPages: number;
    hintSubject?: string | null;
    hintCurriculum?: ExamPrepCurriculum | null;
    hintOutcomes?: LearningOutcome[];
  },
): Promise<PdfPersistenceStats> {
  const pages = await loadPdfPages(options.buffer, {
    maxPages: options.maxPages,
  });
  const rawChunks = chunkPagesToRawText(pages);

  if (!rawChunks.length) {
    return {
      pdfId: options.pdf.id,
      fileName: options.pdf.fileName,
      role: "material",
      mode: "text",
      storedChunks: 0,
      storedFigures: 0,
      skipped: 0,
      errors: ["Metin chunk üretilemedi."],
    };
  }

  return persistRawChunks(supabase, openai, {
    role: "material",
    pdf: options.pdf,
    ownerUserId: options.ownerUserId,
    examGoal: options.examGoal,
    rawChunks,
    hintSubject: options.hintSubject,
    hintCurriculum: options.hintCurriculum,
    hintOutcomes: options.hintOutcomes,
  });
}

export async function persistTextCurriculumPdf(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    pdf: StudentPdfInput;
    buffer: Buffer;
    ownerUserId: string;
    examGoal: string;
    maxPages: number;
    hintSubject?: string | null;
    hintCurriculum?: ExamPrepCurriculum | null;
    hintOutcomes?: LearningOutcome[];
  },
): Promise<PdfPersistenceStats> {
  const pages = await loadPdfPages(options.buffer, {
    maxPages: options.maxPages,
  });
  const rawChunks = chunkPagesToRawText(pages);

  if (!rawChunks.length) {
    return {
      pdfId: options.pdf.id,
      fileName: options.pdf.fileName,
      role: "curriculum",
      mode: "text",
      storedChunks: 0,
      storedFigures: 0,
      skipped: 0,
      errors: ["Müfredat chunk üretilemedi."],
    };
  }

  return persistRawChunks(supabase, openai, {
    role: "curriculum",
    pdf: options.pdf,
    ownerUserId: options.ownerUserId,
    examGoal: options.examGoal,
    rawChunks,
    hintSubject: options.hintSubject,
    hintCurriculum: options.hintCurriculum,
    hintOutcomes: options.hintOutcomes,
  });
}

export async function persistTextQuestionPdf(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    pdf: StudentPdfInput;
    buffer: Buffer;
    ownerUserId: string;
    examGoal: string;
    maxPages: number;
    hintSubject?: string | null;
    hintCurriculum?: ExamPrepCurriculum | null;
    hintOutcomes?: LearningOutcome[];
  },
): Promise<PdfPersistenceStats> {
  const pages = await loadPdfPages(options.buffer, {
    maxPages: options.maxPages,
  });
  const rawChunks = chunkPagesToQuestions(pages);

  if (!rawChunks.length) {
    return {
      pdfId: options.pdf.id,
      fileName: options.pdf.fileName,
      role: "question",
      mode: "text",
      storedChunks: 0,
      storedFigures: 0,
      skipped: 0,
      errors: ["Soru chunk üretilemedi."],
    };
  }

  return persistRawChunks(supabase, openai, {
    role: "question",
    pdf: options.pdf,
    ownerUserId: options.ownerUserId,
    examGoal: options.examGoal,
    rawChunks,
    hintSubject: options.hintSubject,
    hintCurriculum: options.hintCurriculum,
    hintOutcomes: options.hintOutcomes,
  });
}
