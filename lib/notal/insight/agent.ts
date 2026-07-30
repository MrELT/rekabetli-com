import {
  createNotalOpenAI,
  NOTAL_ORCHESTRATOR_MODEL,
} from "@/lib/notal/openai-client";
import { extractOutputText } from "@/lib/notal/openai-helpers";
import type { NotalQuestionSolution } from "@/lib/notal/question-solver/agent";
import type { YksTopicsExam } from "@/lib/notal/yks-topics";

export const NOTAL_INSIGHT_AGENT_MODEL = "gpt-5.6-luna";

export type NotalKnowledgeCard = {
  id: string;
  exam: YksTopicsExam;
  branch: string;
  topic: string;
  title: string;
  summary: string;
  keyPoints: string[];
  formula?: string;
  trap?: string;
  sourceSolutionId?: string;
};

function createLocalId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeJsonParse(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenceMatch?.[1]) return null;
    try {
      return JSON.parse(fenceMatch[1]) as unknown;
    } catch {
      return null;
    }
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * Solved question → compact knowledge card for the exam page.
 */
export async function runInsightAgent(options: {
  solution: NotalQuestionSolution;
  signal?: AbortSignal;
}): Promise<NotalKnowledgeCard> {
  const openai = createNotalOpenAI();
  const model = NOTAL_INSIGHT_AGENT_MODEL || NOTAL_ORCHESTRATOR_MODEL;
  const { solution } = options;

  const prompt = `
Sen NotAl çıkarım (insight) ajanısın.
Görevin: çözülmüş bir YKS sorusundan öğrenci için tek bir bilgi kartı üretmek.

Kurallar:
- Türkçe yaz.
- Kart kısa ve net olsun; ezberlenebilir bir özet ver.
- Markdown kalınlık (**...**) kullanma.
- Uzun formülleri summary içine gömme; formula alanına yaz.
- summary içinde kısa inline formül varsa $...$ kullan.
- formula alanında $$...$$ veya saf LaTeX kullan.
- Soru çözümünü tekrar etme; kavramı/kuralı çıkar.

ÇIKTI: tek JSON nesnesi
- title: kısa başlık (max ~60 karakter)
- summary: 1-2 cümle, okunabilir özet (uzun denklem yok)
- keyPoints: 2-5 kısa madde (string dizisi), gerekirse kısa $...$ formül
- formula: ana formül ($$...$$), yoksa ""
- trap: opsiyonel yaygın hata/tuzak (string veya "")
  `.trim();

  const response = await openai.responses.create(
    {
      model,
      instructions:
        "Sadece JSON döndür. JSON dışı metin yazma. Bilgi kartı üret.",
      input: [
        {
          role: "user",
          content: `${prompt}

Kaynak:
- exam: ${solution.exam}
- branch: ${solution.branch}
- topic: ${solution.topic}
- question:
${solution.question}
- solution:
${solution.solution}
- finalAnswer: ${solution.finalAnswer || ""}`,
        },
      ] as never,
      reasoning: { effort: "low" },
    },
    options.signal ? { signal: options.signal } : undefined,
  );

  const text = extractOutputText(response as never);
  const parsed = safeJsonParse(text);
  const obj =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};

  const title = asString(obj.title) || `${solution.branch}: ${solution.topic}`;
  const summary =
    asString(obj.summary) ||
    "Bu sorudan konuyla ilgili temel kural çıkarılmıştır.";
  const keyPoints = asStringList(obj.keyPoints);
  const formula = asString(obj.formula) || undefined;
  const trap = asString(obj.trap) || undefined;

  return {
    id: createLocalId(),
    exam: solution.exam,
    branch: solution.branch,
    topic: solution.topic,
    title,
    summary,
    keyPoints:
      keyPoints.length > 0
        ? keyPoints
        : ["Konunun temel kuralını ve seçenek tuzaklarını tekrar et."],
    formula,
    trap,
    sourceSolutionId: solution.id,
  };
}
