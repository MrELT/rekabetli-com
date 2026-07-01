import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import type { ClassificationResult } from "@/lib/agents/content_generation/types";
import {
  YKS_FIGURES_MATCH_COUNT,
  YKS_FIGURES_MATCH_THRESHOLD,
} from "@/lib/yks-figures/constants";
import { createYksFigureQueryEmbedding } from "@/lib/yks-figures/embed";
import type { YksFigureMatch } from "@/lib/yks-figures/types";

interface MatchYksFiguresRow {
  id: string;
  figure_type: string;
  subject: string;
  curriculum: string;
  topic: string;
  caption: string;
  public_url: string;
  page_number: number;
  source_name: string | null;
  similarity: number | null;
}

interface MatchLinkedRow {
  id: string;
  figure_type: string;
  subject: string;
  topic: string;
  caption: string;
  public_url: string;
  page_number: number;
  link_score: number | null;
  similarity: number | null;
}

function rowToMatch(row: MatchYksFiguresRow): YksFigureMatch {
  return {
    id: row.id,
    figureType: row.figure_type,
    subject: row.subject,
    curriculum: row.curriculum,
    topic: row.topic,
    caption: row.caption,
    publicUrl: row.public_url,
    pageNumber: row.page_number,
    sourceName: row.source_name,
    similarity: typeof row.similarity === "number" ? row.similarity : 0,
  };
}

function linkedRowToMatch(row: MatchLinkedRow): YksFigureMatch {
  return {
    id: row.id,
    figureType: row.figure_type,
    subject: row.subject,
    curriculum: "",
    topic: row.topic,
    caption: row.caption,
    publicUrl: row.public_url,
    pageNumber: row.page_number,
    sourceName: null,
    similarity: typeof row.similarity === "number" ? row.similarity : 0,
    linkScore: typeof row.link_score === "number" ? row.link_score : 0,
  };
}

function mapClassificationCurriculum(
  classification: ClassificationResult,
): string | null {
  if (classification.curriculum === "TYT") return "TYT";
  if (classification.curriculum === "AYT") return "AYT";
  return null;
}

export async function matchYksFigures(
  supabase: SupabaseClient,
  openai: OpenAI,
  queryText: string,
  options?: {
    filterSubject?: string | null;
    filterCurriculum?: string | null;
    threshold?: number;
    count?: number;
  },
): Promise<YksFigureMatch | null> {
  const threshold = options?.threshold ?? YKS_FIGURES_MATCH_THRESHOLD;
  const count = options?.count ?? YKS_FIGURES_MATCH_COUNT;

  const queryEmbedding = await createYksFigureQueryEmbedding(openai, queryText);

  const { data, error } = await supabase.rpc("match_yks_figures", {
    query_embedding: queryEmbedding,
    filter_subject: options?.filterSubject ?? null,
    filter_curriculum: options?.filterCurriculum ?? null,
    match_threshold: threshold,
    match_count: count,
  });

  if (error) {
    console.error("[yks-figure-rag] match_yks_figures hatası:", error);
    return null;
  }

  if (!Array.isArray(data) || !data.length) return null;

  const best = rowToMatch(data[0] as MatchYksFiguresRow);
  return best.similarity >= threshold ? best : null;
}

export async function matchYksFiguresMany(
  supabase: SupabaseClient,
  openai: OpenAI,
  queryText: string,
  options?: {
    filterSubject?: string | null;
    filterCurriculum?: string | null;
    threshold?: number;
    count?: number;
  },
): Promise<YksFigureMatch[]> {
  const threshold = options?.threshold ?? YKS_FIGURES_MATCH_THRESHOLD;
  const count = options?.count ?? YKS_FIGURES_MATCH_COUNT;

  const queryEmbedding = await createYksFigureQueryEmbedding(openai, queryText);

  const { data, error } = await supabase.rpc("match_yks_figures", {
    query_embedding: queryEmbedding,
    filter_subject: options?.filterSubject ?? null,
    filter_curriculum: options?.filterCurriculum ?? null,
    match_threshold: threshold,
    match_count: count,
  });

  if (error) {
    console.error("[yks-figure-rag] match_yks_figures hatası:", error);
    return [];
  }

  if (!Array.isArray(data) || !data.length) return [];

  return (data as MatchYksFiguresRow[])
    .map(rowToMatch)
    .filter((match) => match.similarity >= threshold);
}

export async function matchYksFiguresForVisualRequest(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    topic: string;
    requestDescription: string;
    classification?: ClassificationResult | null;
    chunkIds?: string[];
  },
): Promise<YksFigureMatch | null> {
  const query = [
    options.topic.trim(),
    options.requestDescription.trim(),
    "şema grafik tablo figür",
  ].join(". ");

  const queryEmbedding = await createYksFigureQueryEmbedding(openai, query);
  const threshold = YKS_FIGURES_MATCH_THRESHOLD;

  if (options.chunkIds?.length) {
    const { data, error } = await supabase.rpc("match_yks_figures_for_chunks", {
      query_embedding: queryEmbedding,
      chunk_ids: options.chunkIds,
      match_threshold: Math.max(0.6, threshold - 0.08),
      match_count: YKS_FIGURES_MATCH_COUNT,
    });

    if (!error && Array.isArray(data) && data.length) {
      const best = linkedRowToMatch(data[0] as MatchLinkedRow);
      if (best.similarity >= threshold - 0.08 || (best.linkScore ?? 0) >= 0.5) {
        return best;
      }
    }
  }

  const filterCurriculum = options.classification
    ? mapClassificationCurriculum(options.classification)
    : null;

  return matchYksFigures(supabase, openai, query, {
    filterCurriculum,
    threshold,
  });
}

export function buildMarkdownFromYksFigure(match: YksFigureMatch): string {
  const alt = match.caption.replace(/[\[\]]/g, "").trim() || match.topic;
  const blocks = [`![${alt}](${match.publicUrl})`];

  if (match.caption.trim()) {
    blocks.push(`*${match.caption.trim()}*`);
  }

  return blocks.join("\n\n");
}
