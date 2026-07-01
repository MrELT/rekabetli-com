import type { SupabaseClient } from "@supabase/supabase-js";

import type { LabeledYksChunk } from "@/lib/yks-chunks/types";

interface InsertYksChunkParams {
  chunk: LabeledYksChunk;
  embedding: number[];
  sourceName: string;
  sourcePdf: string;
  pageStart: number;
  pageEnd: number;
  metadata?: Record<string, unknown>;
}

export async function insertYksChunkRecord(
  supabase: SupabaseClient,
  params: InsertYksChunkParams,
): Promise<string> {
  const { chunk } = params;

  const { data, error } = await supabase
    .from("yks_chunks")
    .insert({
      chunk_type: chunk.chunkType,
      subject: chunk.subject,
      curriculum: chunk.curriculum,
      topic: chunk.topic,
      subtopic: chunk.subtopic,
      content: chunk.content,
      difficulty: chunk.difficulty,
      source_name: params.sourceName,
      source_pdf: params.sourcePdf,
      page_start: params.pageStart,
      page_end: params.pageEnd,
      metadata: {
        ingested_at: new Date().toISOString(),
        ...params.metadata,
      },
      embedding: params.embedding,
      is_published: true,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw error ?? new Error("yks_chunks kaydı oluşturulamadı.");
  }

  return String(data.id);
}
