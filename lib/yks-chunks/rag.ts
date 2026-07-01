import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import type { ClassificationResult } from "@/lib/agents/content_generation/types";
import {
  YKS_CHUNKS_MATCH_COUNT,
  YKS_CHUNKS_MATCH_THRESHOLD,
} from "@/lib/yks-chunks/constants";
import { createYksQueryEmbedding } from "@/lib/yks-chunks/embed";
import type { YksChunkMatch } from "@/lib/yks-chunks/types";

interface MatchYksChunksRow {
  id: string;
  chunk_type: string;
  subject: string;
  curriculum: string;
  topic: string;
  subtopic: string;
  content: string;
  source_name: string | null;
  page_start: number | null;
  page_end: number | null;
  similarity: number | null;
}

function mapClassificationCurriculum(
  classification: ClassificationResult,
): string | null {
  if (classification.curriculum === "TYT") return "TYT";
  if (classification.curriculum === "AYT") return "AYT";
  return null;
}

function buildRetrieveQuery(
  topic: string,
  classification: ClassificationResult,
): string {
  return [
    topic.trim(),
    `Müfredat: ${classification.curriculum}`,
    `Niyet: ${classification.intent}`,
    `Seviye: ${classification.level}`,
  ].join(". ");
}

function rowToMatch(row: MatchYksChunksRow): YksChunkMatch {
  return {
    id: row.id,
    chunkType: row.chunk_type,
    subject: row.subject,
    curriculum: row.curriculum,
    topic: row.topic,
    subtopic: row.subtopic,
    content: row.content,
    sourceName: row.source_name,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    similarity: typeof row.similarity === "number" ? row.similarity : 0,
  };
}

export async function matchYksChunks(
  supabase: SupabaseClient,
  openai: OpenAI,
  queryText: string,
  options?: {
    filterSubject?: string | null;
    filterCurriculum?: string | null;
    threshold?: number;
    count?: number;
  },
): Promise<YksChunkMatch[]> {
  const threshold = options?.threshold ?? YKS_CHUNKS_MATCH_THRESHOLD;
  const count = options?.count ?? YKS_CHUNKS_MATCH_COUNT;

  const queryEmbedding = await createYksQueryEmbedding(openai, queryText);

  const { data, error } = await supabase.rpc("match_yks_chunks", {
    query_embedding: queryEmbedding,
    filter_subject: options?.filterSubject ?? null,
    filter_curriculum: options?.filterCurriculum ?? null,
    match_threshold: threshold,
    match_count: count,
  });

  if (error) {
    console.error("[yks-rag] match_yks_chunks hatası:", error);
    return [];
  }

  if (!Array.isArray(data) || !data.length) {
    return [];
  }

  return (data as MatchYksChunksRow[])
    .map(rowToMatch)
    .filter((match) => match.similarity >= threshold);
}

export async function fetchYksChunksForTopic(
  supabase: SupabaseClient,
  openai: OpenAI,
  topic: string,
  classification: ClassificationResult,
): Promise<YksChunkMatch[]> {
  const query = buildRetrieveQuery(topic, classification);
  const filterCurriculum = mapClassificationCurriculum(classification);

  return matchYksChunks(supabase, openai, query, {
    filterCurriculum,
  });
}

const CHUNK_TYPE_LABELS: Record<string, string> = {
  definition: "Tanım",
  theorem: "Teorem",
  explanation: "Anlatım",
  example: "Örnek",
  question: "Soru",
  solution: "Çözüm",
  curriculum: "Müfredat",
};

export function formatYksChunksForContext(matches: YksChunkMatch[]): string {
  return matches
    .map((match, index) => {
      const typeLabel = CHUNK_TYPE_LABELS[match.chunkType] ?? match.chunkType;
      const source =
        match.sourceName && match.pageStart != null
          ? `${match.sourceName} s.${match.pageStart}${match.pageEnd && match.pageEnd !== match.pageStart ? `–${match.pageEnd}` : ""}`
          : (match.sourceName ?? "YKS arşivi");
      const header = `[Kaynak ${index + 1}: ${source} | ${typeLabel} | ${match.subject} ${match.curriculum} | ${match.topic}${match.subtopic ? ` › ${match.subtopic}` : ""} | benzerlik %${(match.similarity * 100).toFixed(1)}]`;

      return `${header}\n${match.content.trim()}`;
    })
    .join("\n\n---\n\n");
}
