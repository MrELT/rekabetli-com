import OpenAI from "openai";

import { AGENT_EMBEDDING_MODEL } from "@/lib/agents/config";
import type {
  KazanımAlignmentResult,
  LearningOutcome,
  MatchedOutcomePair,
} from "@/lib/agents/exam_prep/alignment-types";
import type {
  MaterialPdfReport,
  QuestionPdfReport,
} from "@/lib/agents/exam_prep/types";

const MATCH_THRESHOLD = 0.72;

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replace(/\s+/g, " ")
    .trim();
}

function outcomeKey(outcome: LearningOutcome): string {
  return `${outcome.code}|${normalizeText(outcome.title)}`;
}

function dedupeOutcomes(outcomes: LearningOutcome[]): LearningOutcome[] {
  const seen = new Set<string>();
  const result: LearningOutcome[] = [];

  for (const outcome of outcomes) {
    const key = outcomeKey(outcome);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(outcome);
  }

  return result;
}

export function collectMaterialOutcomes(
  reports: MaterialPdfReport[],
): LearningOutcome[] {
  return dedupeOutcomes(reports.flatMap((report) => report.learningOutcomes));
}

export function collectQuestionOutcomes(
  reports: QuestionPdfReport[],
): LearningOutcome[] {
  return dedupeOutcomes(reports.flatMap((report) => report.learningOutcomes));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildOutcomeEmbedText(outcome: LearningOutcome): string {
  return [
    outcome.unit ? `Ünite: ${outcome.unit}` : "",
    `Kazanım: ${outcome.title}`,
    outcome.code ? `Kod: ${outcome.code}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function embedOutcomes(
  openai: OpenAI,
  outcomes: LearningOutcome[],
): Promise<number[][]> {
  if (!outcomes.length) return [];

  const response = await openai.embeddings.create({
    model: AGENT_EMBEDDING_MODEL,
    input: outcomes.map(buildOutcomeEmbedText),
  });

  return response.data.map((row) => row.embedding);
}

function emptyAlignment(): KazanımAlignmentResult {
  return {
    questionCoveragePct: 0,
    materialCoveragePct: 0,
    overallAlignmentPct: 0,
    matchedCount: 0,
    totalQuestionOutcomes: 0,
    totalMaterialOutcomes: 0,
    matchedPairs: [],
    unmatchedQuestionOutcomes: [],
    unmatchedMaterialOutcomes: [],
  };
}

/** Soru ve konu kazanımları arasında embedding tabanlı uyum skoru hesaplar. */
export async function computeKazanımAlignment(
  openai: OpenAI,
  materialOutcomes: LearningOutcome[],
  questionOutcomes: LearningOutcome[],
): Promise<KazanımAlignmentResult> {
  if (!materialOutcomes.length || !questionOutcomes.length) {
    return {
      ...emptyAlignment(),
      totalMaterialOutcomes: materialOutcomes.length,
      totalQuestionOutcomes: questionOutcomes.length,
      unmatchedQuestionOutcomes: [...questionOutcomes],
      unmatchedMaterialOutcomes: [...materialOutcomes],
    };
  }

  const [materialEmbeddings, questionEmbeddings] = await Promise.all([
    embedOutcomes(openai, materialOutcomes),
    embedOutcomes(openai, questionOutcomes),
  ]);

  const matchedPairs: MatchedOutcomePair[] = [];
  const matchedMaterialIndexes = new Set<number>();
  const matchedQuestionIndexes = new Set<number>();

  for (let q = 0; q < questionOutcomes.length; q++) {
    let bestIndex = -1;
    let bestScore = 0;

    for (let m = 0; m < materialOutcomes.length; m++) {
      const score = cosineSimilarity(
        questionEmbeddings[q],
        materialEmbeddings[m],
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = m;
      }
    }

    if (bestIndex >= 0 && bestScore >= MATCH_THRESHOLD) {
      matchedPairs.push({
        questionOutcome: questionOutcomes[q],
        materialOutcome: materialOutcomes[bestIndex],
        similarity: bestScore,
      });
      matchedQuestionIndexes.add(q);
      matchedMaterialIndexes.add(bestIndex);
    }
  }

  const unmatchedQuestionOutcomes = questionOutcomes.filter(
    (_, index) => !matchedQuestionIndexes.has(index),
  );
  const unmatchedMaterialOutcomes = materialOutcomes.filter(
    (_, index) => !matchedMaterialIndexes.has(index),
  );

  const questionCoveragePct = Math.round(
    (matchedQuestionIndexes.size / questionOutcomes.length) * 100,
  );
  const materialCoveragePct = Math.round(
    (matchedMaterialIndexes.size / materialOutcomes.length) * 100,
  );
  const overallAlignmentPct = Math.round(
    (questionCoveragePct + materialCoveragePct) / 2,
  );

  return {
    questionCoveragePct,
    materialCoveragePct,
    overallAlignmentPct,
    matchedCount: matchedPairs.length,
    totalQuestionOutcomes: questionOutcomes.length,
    totalMaterialOutcomes: materialOutcomes.length,
    matchedPairs,
    unmatchedQuestionOutcomes,
    unmatchedMaterialOutcomes,
  };
}

export function parseLearningOutcomes(raw: unknown): LearningOutcome[] {
  if (!Array.isArray(raw)) return [];

  const outcomes: LearningOutcome[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = String(record.title ?? record.kazanım ?? record.name ?? "").trim();
    if (!title) continue;

    outcomes.push({
      code: String(record.code ?? record.id ?? `K${outcomes.length + 1}`).trim(),
      title,
      unit: String(record.unit ?? record.unite ?? record.topic ?? "").trim(),
    });
  }

  return outcomes.slice(0, 40);
}
