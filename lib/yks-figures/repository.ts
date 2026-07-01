import type { SupabaseClient } from "@supabase/supabase-js";

import type { NormalizedBbox } from "@/lib/yks-figures/types";

interface InsertYksFigureParams {
  figureType: string;
  subject: string;
  curriculum: string;
  topic: string;
  caption: string;
  storagePath: string;
  publicUrl: string;
  sourcePdf: string;
  sourceName: string;
  pageNumber: number;
  bbox: NormalizedBbox;
  width: number;
  height: number;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export async function insertYksFigureRecord(
  supabase: SupabaseClient,
  params: InsertYksFigureParams,
): Promise<string> {
  const { data, error } = await supabase
    .from("yks_figures")
    .insert({
      figure_type: params.figureType,
      subject: params.subject,
      curriculum: params.curriculum,
      topic: params.topic,
      caption: params.caption,
      storage_path: params.storagePath,
      public_url: params.publicUrl,
      source_pdf: params.sourcePdf,
      source_name: params.sourceName,
      page_number: params.pageNumber,
      bbox: params.bbox,
      width: params.width,
      height: params.height,
      metadata: params.metadata ?? {},
      embedding: params.embedding,
      is_published: true,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw error ?? new Error("yks_figures kaydı oluşturulamadı.");
  }

  return String(data.id);
}

export async function insertChunkFigureLinks(
  supabase: SupabaseClient,
  links: { chunkId: string; figureId: string; linkScore: number }[],
): Promise<void> {
  if (!links.length) return;

  const { error } = await supabase.from("yks_chunk_figures").upsert(
    links.map((link) => ({
      chunk_id: link.chunkId,
      figure_id: link.figureId,
      link_score: link.linkScore,
    })),
    { onConflict: "chunk_id,figure_id" },
  );

  if (error) {
    throw error;
  }
}
