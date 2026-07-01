import OpenAI from "openai";

import { buildChatCompletionParams } from "@/lib/agents/llm";
import { YKS_CHUNK_LABEL_MODEL } from "@/lib/yks-chunks/constants";
import {
  YKS_CHUNK_TYPES,
  type LabeledYksChunk,
  type YksChunkType,
  type YksCurriculum,
} from "@/lib/yks-chunks/types";

const LABEL_SYSTEM_PROMPT = `Sen YKS kitap içeriği sınıflandırıcısısın.
Verilen metin kesitini analiz edip yalnızca JSON döndür.

Alanlar:
- chunk_type: ${YKS_CHUNK_TYPES.join(" | ")}
- subject: ders adı (ör. Matematik, Fizik, Türkçe)
- curriculum: TYT | AYT | genel
- topic: ana konu başlığı
- subtopic: alt konu (yoksa boş string)
- difficulty: kolay | orta | zor

Metni yeniden yazma; yalnızca etiketle.`;

function extractJsonFromResponse(text: string): unknown {
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
    throw new Error("Chunk etiket yanıtı JSON olarak parse edilemedi.");
  }
}

function normalizeChunkType(value: unknown): YksChunkType {
  const raw = String(value ?? "explanation").trim().toLowerCase();
  if (YKS_CHUNK_TYPES.includes(raw as YksChunkType)) {
    return raw as YksChunkType;
  }
  if (raw.includes("tanım") || raw.includes("definition")) return "definition";
  if (raw.includes("teorem") || raw.includes("theorem")) return "theorem";
  if (raw.includes("örnek") || raw.includes("example")) return "example";
  if (raw.includes("soru") || raw.includes("question")) return "question";
  if (raw.includes("çözüm") || raw.includes("solution")) return "solution";
  return "explanation";
}

function normalizeCurriculum(
  value: unknown,
  hint?: YksCurriculum,
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

function parseLabelPayload(
  raw: unknown,
  content: string,
  hints?: { subject?: string; curriculum?: YksCurriculum },
): LabeledYksChunk | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const subject =
    String(record.subject ?? hints?.subject ?? "Genel").trim() || "Genel";
  const topic = String(record.topic ?? "").trim();
  if (!topic) return null;

  return {
    chunkType: normalizeChunkType(record.chunk_type ?? record.chunkType),
    subject,
    curriculum: normalizeCurriculum(
      record.curriculum,
      hints?.curriculum,
    ),
    topic,
    subtopic: String(record.subtopic ?? record.sub_topic ?? "").trim(),
    content,
    difficulty: normalizeDifficulty(record.difficulty),
  };
}

export async function labelYksTextChunk(
  openai: OpenAI,
  chunkText: string,
  options?: {
    fileName?: string;
    pageStart?: number;
    pageEnd?: number;
    hintSubject?: string;
    hintCurriculum?: YksCurriculum;
  },
): Promise<LabeledYksChunk> {
  const pageHint =
    options?.pageStart != null
      ? `Sayfa: ${options.pageStart}${options.pageEnd && options.pageEnd !== options.pageStart ? `–${options.pageEnd}` : ""}`
      : "";
  const hintLines = [
    options?.fileName ? `Kaynak: ${options.fileName}` : "",
    pageHint,
    options?.hintSubject ? `Beklenen ders: ${options.hintSubject}` : "",
    options?.hintCurriculum ? `Beklenen müfredat: ${options.hintCurriculum}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      YKS_CHUNK_LABEL_MODEL,
      [
        { role: "system", content: LABEL_SYSTEM_PROMPT },
        {
          role: "user",
          content: `${hintLines ? `${hintLines}\n\n` : ""}Metin kesiti:\n${chunkText.slice(0, 3500)}`,
        },
      ],
      { temperature: 0.1, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Chunk etiketleme boş yanıt döndü.");
  }

  const parsed = parseLabelPayload(extractJsonFromResponse(rawText), chunkText, {
    subject: options?.hintSubject,
    curriculum: options?.hintCurriculum,
  });

  if (!parsed) {
    throw new Error("Chunk etiket şeması geçersiz.");
  }

  return parsed;
}
