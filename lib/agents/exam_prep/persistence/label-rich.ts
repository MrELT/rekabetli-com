import OpenAI from "openai";

import { parseLearningOutcomes } from "@/lib/agents/exam_prep/alignment";
import type { LearningOutcome } from "@/lib/agents/exam_prep/alignment-types";
import type {
  ExamPrepRichMetadata,
  LabeledExamPrepChunk,
  PersistContentRole,
} from "@/lib/agents/exam_prep/persistence/types";
import type { ExamPrepCurriculum } from "@/lib/agents/exam_prep/types";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import { YKS_CHUNK_LABEL_MODEL } from "@/lib/yks-chunks/constants";
import {
  YKS_CHUNK_TYPES,
  type YksChunkType,
  type YksCurriculum,
} from "@/lib/yks-chunks/types";

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
    throw new Error("Zengin etiket yanıtı JSON değil.");
  }
}

function normalizeChunkType(value: unknown, role: PersistContentRole): YksChunkType {
  const raw = String(value ?? "").trim().toLowerCase();
  if (YKS_CHUNK_TYPES.includes(raw as YksChunkType)) {
    return raw as YksChunkType;
  }
  if (role === "question") return "question";
  if (role === "curriculum") return "curriculum";
  if (raw.includes("tanım")) return "definition";
  if (raw.includes("teorem")) return "theorem";
  if (raw.includes("örnek")) return "example";
  return "explanation";
}

function normalizeCurriculum(
  value: unknown,
  hint?: ExamPrepCurriculum | null,
): YksCurriculum {
  const raw = String(value ?? hint ?? "genel").trim().toUpperCase();
  if (raw.includes("TYT")) return "TYT";
  if (raw.includes("AYT")) return "AYT";
  return "genel";
}

function normalizeDifficulty(value: unknown): string {
  const raw = String(value ?? "orta").trim().toLowerCase();
  if (raw.includes("kolay") || raw.includes("easy")) return "kolay";
  if (raw.includes("zor") || raw.includes("hard")) return "zor";
  return "orta";
}

function buildSystemPrompt(role: PersistContentRole): string {
  const roleLabel =
    role === "question"
      ? "YKS çıkmış / örnek soru"
      : role === "curriculum"
        ? "resmi sınav müfredatı / kazanım listesi"
        : "YKS konu anlatımı";

  const summaryHint =
    role === "question"
      ? "Soru neyi ölçüyor, öğrenciden ne bekleniyor (2-4 cümle)"
      : role === "curriculum"
        ? "Bu müfredat kesiti hangi ünite/temayı ve kazanımları tanımlıyor (2-4 cümle)"
        : "Bu parça neyi anlatıyor, hangi kavramları kapsıyor (2-4 cümle)";

  return `Sen ${roleLabel} içeriği için yüksek kaliteli metadata üreticisisin.
Verilen metin kesitini analiz edip yalnızca JSON döndür.

Alanlar:
- chunk_type: ${YKS_CHUNK_TYPES.join(" | ")} (müfredat için curriculum tercih et)
- subject: ders adı
- curriculum: TYT | AYT | genel
- topic: ana konu / ünite
- subtopic: alt konu / tema (yoksa "")
- difficulty: kolay | orta | zor (müfredat için genelde orta)
- content_summary: ${summaryHint}
- learning_outcomes: [{ "code": "K1", "title": "...", "unit": "..." }] (2-6 madde)
- key_concepts: ["kavram1", "kavram2"] (3-8 madde)
${
  role === "question"
    ? `- question_number: sayı (bilinmiyorsa null)
- question_type: çoktan seçmeli | doğru-yanlış | açık uçlu | hesaplama vb.
- skills_tested: ["beceri1"] (2-5 madde)`
    : ""
}
${
  role === "curriculum"
    ? `- unit_name: ünite veya tema adı
- official_outcome_code: resmi kazanım kodu (varsa, yoksa "")
- curriculum_section: ünite | tema | alt_tema | genel`
    : ""
}

Metni yeniden yazma; yalnızca etiketle. Kazanımlar ölçülebilir ve arama için net olsun.`;
}

function buildLightSystemPrompt(role: PersistContentRole): string {
  return `Sen ${role === "question" ? "soru" : role === "curriculum" ? "müfredat" : "konu"} chunk etiketleyicisisin.
Envanter ajanı kazanımları ZATEN çıkardı — yeniden kazanım listesi üretme.

Yanıt YALNIZCA JSON:
{
  "chunk_type": "...",
  "subject": "...",
  "curriculum": "TYT | AYT | genel",
  "topic": "...",
  "subtopic": "",
  "difficulty": "kolay | orta | zor",
  "content_summary": "Bu kesit ne anlatıyor / ne soruyor (2-3 cümle)",
  "key_concepts": ["..."],
  "question_number": null,
  "question_type": "",
  "skills_tested": []
}

Kısa ve net ol; learning_outcomes ALANI DÖNDÜRME.`;
}

function pickRelevantOutcomes(
  content: string,
  hints: LearningOutcome[],
  max = 6,
): LearningOutcome[] {
  if (!hints.length) return [];
  const lower = content.toLocaleLowerCase("tr");

  const scored = hints.map((outcome) => {
    const title = outcome.title.toLocaleLowerCase("tr");
    const unit = outcome.unit.toLocaleLowerCase("tr");
    let score = 0;
    if (title.length > 4 && lower.includes(title.slice(0, Math.min(20, title.length)))) {
      score += 3;
    }
    if (unit.length > 3 && lower.includes(unit.slice(0, 15))) score += 2;
    for (const word of title.split(/\s+/).filter((w) => w.length > 4)) {
      if (lower.includes(word)) score += 1;
    }
    return { outcome, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = scored.filter((s) => s.score > 0).map((s) => s.outcome);
  if (picked.length) return picked.slice(0, max);
  return hints.slice(0, max);
}

async function labelExamPrepChunkLight(
  openai: OpenAI,
  content: string,
  options: {
    role: PersistContentRole;
    fileName: string;
    pdfId: string;
    ownerUserId: string;
    pageStart?: number;
    pageEnd?: number;
    hintSubject?: string | null;
    hintCurriculum?: ExamPrepCurriculum | null;
    hintOutcomes: LearningOutcome[];
    examGoal?: string;
  },
): Promise<LabeledExamPrepChunk> {
  const pageHint =
    options.pageStart != null
      ? `Sayfa: ${options.pageStart}${options.pageEnd && options.pageEnd !== options.pageStart ? `–${options.pageEnd}` : ""}`
      : "";

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      YKS_CHUNK_LABEL_MODEL,
      [
        { role: "system", content: buildLightSystemPrompt(options.role) },
        {
          role: "user",
          content: [
            `Kaynak: ${options.fileName}`,
            pageHint,
            options.hintSubject ? `Ders: ${options.hintSubject}` : "",
            options.hintCurriculum ? `Müfredat: ${options.hintCurriculum}` : "",
            `PDF kazanımları (envanterden): ${options.hintOutcomes.map((o) => o.title).join("; ")}`,
            "",
            "Metin kesiti:",
            content.slice(0, 3500),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      { temperature: 0.1, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Hafif chunk etiketi boş yanıt döndü.");
  }

  const record = extractJson(rawText) as Record<string, unknown>;
  const topic =
    String(record.topic ?? options.hintOutcomes[0]?.unit ?? "Genel").trim() ||
    "Genel";

  const learningOutcomes = pickRelevantOutcomes(content, options.hintOutcomes);
  const keyConcepts = Array.isArray(record.key_concepts)
    ? record.key_concepts.map((c) => String(c).trim()).filter(Boolean)
    : [];

  const rich: ExamPrepRichMetadata = {
    pipeline: "exam_prep",
    ownerUserId: options.ownerUserId,
    pdfId: options.pdfId,
    contentRole: options.role,
    contentSummary: String(record.content_summary ?? record.summary ?? "").trim(),
    learningOutcomes,
    keyConcepts,
    examGoal: options.examGoal,
    agentInventoryUsed: true,
  };

  if (options.role === "question") {
    const qNum = Number(record.question_number);
    if (Number.isFinite(qNum) && qNum > 0) rich.questionNumber = qNum;
    rich.questionType = String(record.question_type ?? "").trim() || undefined;
    rich.skillsTested = Array.isArray(record.skills_tested)
      ? record.skills_tested.map((s) => String(s).trim()).filter(Boolean)
      : [];
  }

  if (options.role === "curriculum") {
    rich.unitName = options.hintOutcomes[0]?.unit || topic;
    rich.officialOutcomeCode = options.hintOutcomes[0]?.code;
    rich.curriculumSection = "ünite";
  }

  return {
    chunkType: normalizeChunkType(record.chunk_type, options.role),
    subject:
      String(record.subject ?? options.hintSubject ?? "Genel").trim() || "Genel",
    curriculum: normalizeCurriculum(record.curriculum, options.hintCurriculum),
    topic,
    subtopic: String(record.subtopic ?? "").trim(),
    content,
    difficulty: normalizeDifficulty(record.difficulty),
    rich,
  };
}

export function buildRichEmbeddingText(chunk: LabeledExamPrepChunk): string {
  const outcomes = chunk.rich.learningOutcomes
    .map((o) => `${o.code}: ${o.title}`)
    .join("; ");

  return [
    `Ders: ${chunk.subject}`,
    `Müfredat: ${chunk.curriculum}`,
    `Tür: ${chunk.chunkType}`,
    `Konu: ${chunk.topic}`,
    chunk.subtopic ? `Alt konu: ${chunk.subtopic}` : "",
    chunk.rich.contentSummary ? `Özet: ${chunk.rich.contentSummary}` : "",
    outcomes ? `Kazanımlar: ${outcomes}` : "",
    chunk.rich.keyConcepts.length
      ? `Kavramlar: ${chunk.rich.keyConcepts.join(", ")}`
      : "",
    chunk.rich.unitName ? `Ünite: ${chunk.rich.unitName}` : "",
    chunk.rich.officialOutcomeCode
      ? `Resmi kod: ${chunk.rich.officialOutcomeCode}`
      : "",
    chunk.rich.skillsTested?.length
      ? `Beceriler: ${chunk.rich.skillsTested.join(", ")}`
      : "",
    `İçerik:\n${chunk.content}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function labelExamPrepChunk(
  openai: OpenAI,
  content: string,
  options: {
    role: PersistContentRole;
    fileName: string;
    pdfId: string;
    ownerUserId: string;
    pageStart?: number;
    pageEnd?: number;
    hintSubject?: string | null;
    hintCurriculum?: ExamPrepCurriculum | null;
    hintOutcomes?: LearningOutcome[];
    examGoal?: string;
  },
): Promise<LabeledExamPrepChunk> {
  if ((options.hintOutcomes?.length ?? 0) > 0) {
    return labelExamPrepChunkLight(openai, content, {
      ...options,
      hintOutcomes: options.hintOutcomes!,
    });
  }

  const pageHint =
    options.pageStart != null
      ? `Sayfa: ${options.pageStart}${options.pageEnd && options.pageEnd !== options.pageStart ? `–${options.pageEnd}` : ""}`
      : "";

  const outcomeHint = options.hintOutcomes?.length
    ? `PDF genel kazanımları: ${options.hintOutcomes.map((o) => o.title).join("; ")}`
    : "";

  const userLines = [
    `Kaynak: ${options.fileName}`,
    pageHint,
    options.examGoal ? `Sınav hedefi: ${options.examGoal}` : "",
    options.hintSubject ? `Beklenen ders: ${options.hintSubject}` : "",
    options.hintCurriculum ? `Müfredat: ${options.hintCurriculum}` : "",
    outcomeHint,
    "",
    "Metin kesiti:",
    content.slice(0, 4000),
  ]
    .filter((line) => line !== "")
    .join("\n");

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      YKS_CHUNK_LABEL_MODEL,
      [
        { role: "system", content: buildSystemPrompt(options.role) },
        { role: "user", content: userLines },
      ],
      { temperature: 0.12, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Zengin chunk etiketi boş yanıt döndü.");
  }

  const record = extractJson(rawText) as Record<string, unknown>;
  const topic = String(record.topic ?? "").trim();
  if (!topic) {
    throw new Error("Chunk topic eksik.");
  }

  const learningOutcomes = parseLearningOutcomes(record.learning_outcomes);
  const keyConcepts = Array.isArray(record.key_concepts)
    ? record.key_concepts.map((c) => String(c).trim()).filter(Boolean)
    : [];

  const rich: ExamPrepRichMetadata = {
    pipeline: "exam_prep",
    ownerUserId: options.ownerUserId,
    pdfId: options.pdfId,
    contentRole: options.role,
    contentSummary: String(record.content_summary ?? record.summary ?? "").trim(),
    learningOutcomes: learningOutcomes.length
      ? learningOutcomes
      : (options.hintOutcomes ?? []).slice(0, 6),
    keyConcepts,
    examGoal: options.examGoal,
    agentInventoryUsed: false,
  };

  if (options.role === "question") {
    const qNum = Number(record.question_number);
    if (Number.isFinite(qNum) && qNum > 0) {
      rich.questionNumber = qNum;
    }
    rich.questionType = String(record.question_type ?? "").trim() || undefined;
    rich.skillsTested = Array.isArray(record.skills_tested)
      ? record.skills_tested.map((s) => String(s).trim()).filter(Boolean)
      : [];
  }

  if (options.role === "curriculum") {
    rich.unitName =
      String(record.unit_name ?? record.unit ?? options.hintOutcomes?.[0]?.unit ?? "")
        .trim() || undefined;
    rich.officialOutcomeCode =
      String(record.official_outcome_code ?? record.outcome_code ?? "").trim() ||
      undefined;
    rich.curriculumSection =
      String(record.curriculum_section ?? "genel").trim() || "genel";
  }

  return {
    chunkType: normalizeChunkType(record.chunk_type, options.role),
    subject:
      String(record.subject ?? options.hintSubject ?? "Genel").trim() || "Genel",
    curriculum: normalizeCurriculum(record.curriculum, options.hintCurriculum),
    topic,
    subtopic: String(record.subtopic ?? "").trim(),
    content,
    difficulty: normalizeDifficulty(record.difficulty),
    rich,
  };
}

export async function labelExamPrepQuestionFigure(
  openai: OpenAI,
  options: {
    textPreview: string;
    fileName: string;
    pdfId: string;
    ownerUserId: string;
    pageNumber: number;
    hintSubject?: string | null;
    hintCurriculum?: ExamPrepCurriculum | null;
    hintOutcomes?: LearningOutcome[];
    examGoal?: string;
    imageBase64: string;
  },
): Promise<{
  topic: string;
  subtopic: string;
  subject: string;
  curriculum: YksCurriculum;
  difficulty: string;
  caption: string;
  rich: ExamPrepRichMetadata;
}> {
  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      YKS_CHUNK_LABEL_MODEL,
      [
        {
          role: "system",
          content: `Sen taranmış YKS soru görseli analiz uzmanısın. Soru kutusunun ne ölçtüğünü detaylı etiketle.
Yanıt YALNIZCA JSON:
{
  "subject": "ders",
  "curriculum": "TYT | AYT | genel",
  "topic": "konu",
  "subtopic": "alt konu",
  "difficulty": "kolay | orta | zor",
  "content_summary": "Soru neyi ölçüyor (2-4 cümle)",
  "caption": "Soru için kısa başlık (arama uyumlu)",
  "learning_outcomes": [{ "code": "S1", "title": "...", "unit": "..." }],
  "key_concepts": ["..."],
  "question_type": "...",
  "skills_tested": ["..."],
  "question_number": null
}`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Kaynak: ${options.fileName}, sayfa ${options.pageNumber}`,
                options.examGoal ? `Hedef: ${options.examGoal}` : "",
                `Metin önizleme: ${options.textPreview}`,
              ]
                .filter(Boolean)
                .join("\n"),
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${options.imageBase64}`,
                detail: "low",
              },
            },
          ],
        },
      ],
      { temperature: 0.12, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Soru figür etiketi boş yanıt döndü.");
  }

  const record = extractJson(rawText) as Record<string, unknown>;
  const topic = String(record.topic ?? "Genel").trim() || "Genel";
  const caption =
    String(record.caption ?? record.content_summary ?? options.textPreview).trim() ||
    options.textPreview;

  const learningOutcomes = parseLearningOutcomes(record.learning_outcomes);
  const rich: ExamPrepRichMetadata = {
    pipeline: "exam_prep",
    ownerUserId: options.ownerUserId,
    pdfId: options.pdfId,
    contentRole: "question",
    contentSummary: String(record.content_summary ?? "").trim() || caption,
    learningOutcomes: learningOutcomes.length
      ? learningOutcomes
      : (options.hintOutcomes ?? []).slice(0, 6),
    keyConcepts: Array.isArray(record.key_concepts)
      ? record.key_concepts.map((c) => String(c).trim()).filter(Boolean)
      : [],
    questionType: String(record.question_type ?? "").trim() || undefined,
    skillsTested: Array.isArray(record.skills_tested)
      ? record.skills_tested.map((s) => String(s).trim()).filter(Boolean)
      : [],
    examGoal: options.examGoal,
  };

  const qNum = Number(record.question_number);
  if (Number.isFinite(qNum) && qNum > 0) {
    rich.questionNumber = qNum;
  }

  return {
    topic,
    subtopic: String(record.subtopic ?? "").trim(),
    subject:
      String(record.subject ?? options.hintSubject ?? "Genel").trim() || "Genel",
    curriculum: normalizeCurriculum(record.curriculum, options.hintCurriculum),
    difficulty: normalizeDifficulty(record.difficulty),
    caption,
    rich,
  };
}

export function buildFigureRichEmbeddingText(options: {
  caption: string;
  topic: string;
  subject: string;
  curriculum: string;
  rich: ExamPrepRichMetadata;
}): string {
  const outcomes = options.rich.learningOutcomes
    .map((o) => `${o.code}: ${o.title}`)
    .join("; ");

  return [
    "Tür: question",
    `Ders: ${options.subject}`,
    `Müfredat: ${options.curriculum}`,
    `Konu: ${options.topic}`,
    `Özet: ${options.rich.contentSummary}`,
    outcomes ? `Kazanımlar: ${outcomes}` : "",
    options.rich.skillsTested?.length
      ? `Beceriler: ${options.rich.skillsTested.join(", ")}`
      : "",
    `Açıklama: ${options.caption}`,
  ]
    .filter(Boolean)
    .join("\n");
}
