import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import { loadPdfPages } from "@/lib/pdf-page-render";
import { chunkPagesToRawText } from "@/lib/yks-chunks/chunking";
import { YKS_INGESTION_MAX_PAGES } from "@/lib/yks-chunks/constants";
import { createYksChunkEmbedding } from "@/lib/yks-chunks/embed";
import { labelYksTextChunk } from "@/lib/yks-chunks/label-chunk";
import { insertYksChunkRecord } from "@/lib/yks-chunks/repository";
import type { YksCurriculum, YksTextIngestResult } from "@/lib/yks-chunks/types";

const LABEL_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export interface IngestYksTextPdfOptions {
  buffer: Buffer;
  fileName: string;
  supabase: SupabaseClient;
  openai: OpenAI;
  hintSubject?: string;
  hintCurriculum?: YksCurriculum;
}

/** PDF metin katmanını chunk'layıp yks_chunks tablosuna yazar (Faz A). */
export async function ingestPdfForYksTextRag(
  options: IngestYksTextPdfOptions,
): Promise<YksTextIngestResult> {
  const { buffer, fileName, supabase, openai, hintSubject, hintCurriculum } =
    options;

  const pages = await loadPdfPages(buffer, { maxPages: YKS_INGESTION_MAX_PAGES });
  const rawChunks = chunkPagesToRawText(pages);

  const errors: string[] = [];
  let storedChunkCount = 0;
  let skippedChunkCount = 0;

  const sourceName = fileName.replace(/\.pdf$/i, "").trim() || fileName;

  await mapWithConcurrency(rawChunks, LABEL_CONCURRENCY, async (raw, index) => {
    try {
      const labeled = await labelYksTextChunk(openai, raw.text, {
        fileName,
        pageStart: raw.pageStart,
        pageEnd: raw.pageEnd,
        hintSubject,
        hintCurriculum,
      });

      const embedding = await createYksChunkEmbedding(openai, labeled);

      await insertYksChunkRecord(supabase, {
        chunk: labeled,
        embedding,
        sourceName,
        sourcePdf: fileName,
        pageStart: raw.pageStart,
        pageEnd: raw.pageEnd,
      });

      storedChunkCount += 1;
    } catch (error) {
      skippedChunkCount += 1;
      const message =
        error instanceof Error ? error.message : "Chunk işlenemedi.";
      errors.push(`Chunk ${index + 1} (s.${raw.pageStart}): ${message}`);
    }
  });

  return {
    fileName,
    processedPageCount: pages.length,
    rawChunkCount: rawChunks.length,
    storedChunkCount,
    skippedChunkCount,
    errors,
  };
}
