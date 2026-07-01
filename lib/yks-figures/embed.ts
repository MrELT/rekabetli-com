import OpenAI from "openai";

import { YKS_FIGURES_EMBEDDING_MODEL } from "@/lib/yks-figures/constants";

export function buildYksFigureEmbeddingText(options: {
  caption: string;
  figureType: string;
  subject: string;
  curriculum: string;
  topic: string;
  relatedTopics?: string[];
}): string {
  const topics = options.relatedTopics?.filter(Boolean).join(", ");
  return [
    `Tür: ${options.figureType}`,
    `Ders: ${options.subject}`,
    `Müfredat: ${options.curriculum}`,
    `Konu: ${options.topic}`,
    topics ? `İlgili konular: ${topics}` : "",
    `Açıklama: ${options.caption}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function createYksFigureEmbedding(
  openai: OpenAI,
  text: string,
): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: YKS_FIGURES_EMBEDDING_MODEL,
    input: text,
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding?.length) {
    throw new Error("Figür embedding oluşturulamadı.");
  }

  return embedding;
}

export async function createYksFigureQueryEmbedding(
  openai: OpenAI,
  query: string,
): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: YKS_FIGURES_EMBEDDING_MODEL,
    input: query.trim(),
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding?.length) {
    throw new Error("Figür sorgu embedding oluşturulamadı.");
  }

  return embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
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
