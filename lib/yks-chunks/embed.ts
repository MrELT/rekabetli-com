import OpenAI from "openai";

import { YKS_CHUNKS_EMBEDDING_MODEL } from "@/lib/yks-chunks/constants";
import type { LabeledYksChunk } from "@/lib/yks-chunks/types";

export function buildYksChunkEmbeddingText(chunk: LabeledYksChunk): string {
  const parts = [
    `Ders: ${chunk.subject}`,
    `Müfredat: ${chunk.curriculum}`,
    `Tür: ${chunk.chunkType}`,
    `Konu: ${chunk.topic}`,
    chunk.subtopic ? `Alt konu: ${chunk.subtopic}` : "",
    `İçerik:\n${chunk.content}`,
  ].filter(Boolean);

  return parts.join("\n");
}

export async function createYksChunkEmbedding(
  openai: OpenAI,
  chunk: LabeledYksChunk,
): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: YKS_CHUNKS_EMBEDDING_MODEL,
    input: buildYksChunkEmbeddingText(chunk),
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding?.length) {
    throw new Error("YKS chunk embedding oluşturulamadı.");
  }

  return embedding;
}

export async function createYksQueryEmbedding(
  openai: OpenAI,
  query: string,
): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: YKS_CHUNKS_EMBEDDING_MODEL,
    input: query.trim(),
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding?.length) {
    throw new Error("YKS sorgu embedding oluşturulamadı.");
  }

  return embedding;
}
