import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import { loadPdfPages } from "@/lib/pdf-page-render";
import { rasterizePdfPages } from "@/lib/pdf-page-raster";
import { chunkPagesToRawText } from "@/lib/yks-chunks/chunking";
import { YKS_INGESTION_MAX_PAGES } from "@/lib/yks-chunks/constants";
import { createYksChunkEmbedding } from "@/lib/yks-chunks/embed";
import { labelYksTextChunk } from "@/lib/yks-chunks/label-chunk";
import { insertYksChunkRecord } from "@/lib/yks-chunks/repository";
import type { YksCurriculum } from "@/lib/yks-chunks/types";
import { cropFigureFromPage, shouldKeepFigureCrop } from "@/lib/yks-figures/crop";
import { detectFiguresOnPage } from "@/lib/yks-figures/detect-figures";
import { buildYksFigureEmbeddingText, createYksFigureEmbedding } from "@/lib/yks-figures/embed";
import { buildChunkFigureLinks } from "@/lib/yks-figures/link-chunks";
import {
  insertChunkFigureLinks,
  insertYksFigureRecord,
} from "@/lib/yks-figures/repository";
import {
  buildYksFigureStoragePath,
  uploadYksFigureToStorage,
} from "@/lib/yks-figures/storage";
import type {
  DetectedFigureRegion,
  DetectedQuestionRegion,
  StoredChunkRef,
} from "@/lib/yks-figures/types";
import type { PdfRasterEngine } from "@/lib/pdf-page-raster";

const LABEL_CONCURRENCY = 2;

export interface YksUnifiedIngestResult {
  fileName: string;
  processedPageCount: number;
  rasterEngine: PdfRasterEngine | "none";
  rawChunkCount: number;
  storedChunkCount: number;
  skippedChunkCount: number;
  detectedFigureCount: number;
  storedFigureCount: number;
  skippedFigureCount: number;
  chunkFigureLinks: number;
  errors: string[];
}

export interface IngestYksUnifiedPdfOptions {
  buffer: Buffer;
  fileName: string;
  supabase: SupabaseClient;
  openai: OpenAI;
  hintSubject?: string;
  hintCurriculum?: YksCurriculum;
}

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

function chunksForPage(chunks: StoredChunkRef[], pageNumber: number): StoredChunkRef[] {
  return chunks.filter(
    (chunk) => pageNumber >= chunk.pageStart && pageNumber <= chunk.pageEnd,
  );
}

async function persistFigureRegion(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    region: DetectedFigureRegion | DetectedQuestionRegion;
    figureType: string;
    caption: string;
    pagePng: Buffer;
    pageWidth: number;
    pageHeight: number;
    pageNumber: number;
    figureIndex: number;
    fileName: string;
    sourceName: string;
    subject: string;
    curriculum: string;
    topic: string;
    relatedTopics?: string[];
    storedChunks: StoredChunkRef[];
  },
): Promise<{ stored: boolean; links: number }> {
  const bbox = options.region.bbox;
  const cropped = await cropFigureFromPage(
    options.pagePng,
    options.pageWidth,
    options.pageHeight,
    bbox,
  );

  if (!cropped) return { stored: false, links: 0 };

  const quality = await shouldKeepFigureCrop(cropped.buffer);
  if (!quality.keep) return { stored: false, links: 0 };

  const storagePath = buildYksFigureStoragePath({
    pdfFileName: options.fileName,
    pageNumber: options.pageNumber,
    figureIndex: options.figureIndex,
  });

  const publicUrl = await uploadYksFigureToStorage(
    supabase,
    storagePath,
    cropped.buffer,
  );

  const relatedTopics =
    "relatedTopics" in options.region ? options.region.relatedTopics : [];

  const embedding = await createYksFigureEmbedding(
    openai,
    buildYksFigureEmbeddingText({
      caption: options.caption,
      figureType: options.figureType,
      subject: options.subject,
      curriculum: options.curriculum,
      topic: options.topic,
      relatedTopics,
    }),
  );

  const figureId = await insertYksFigureRecord(supabase, {
    figureType: options.figureType,
    subject: options.subject,
    curriculum: options.curriculum,
    topic: options.topic,
    caption: options.caption,
    storagePath,
    publicUrl,
    sourcePdf: options.fileName,
    sourceName: options.sourceName,
    pageNumber: options.pageNumber,
    bbox,
    width: cropped.width,
    height: cropped.height,
    embedding,
    metadata: {
      related_topics: relatedTopics,
      pipeline: "faz_b",
    },
  });

  const pageChunks = chunksForPage(options.storedChunks, options.pageNumber);
  const links = buildChunkFigureLinks(embedding, pageChunks).map((link) => ({
    chunkId: link.chunkId,
    figureId,
    linkScore: link.linkScore,
  }));

  await insertChunkFigureLinks(supabase, links);
  return { stored: true, links: links.length };
}

/**
 * Faz B: PDF → metin chunk (yks_chunks) + sayfa render → figür crop (yks_figures) + eşleştirme.
 */
export async function ingestPdfForYksUnified(
  options: IngestYksUnifiedPdfOptions,
): Promise<YksUnifiedIngestResult> {
  const { buffer, fileName, supabase, openai, hintSubject, hintCurriculum } =
    options;

  const errors: string[] = [];
  const sourceName = fileName.replace(/\.pdf$/i, "").trim() || fileName;
  const maxPages = YKS_INGESTION_MAX_PAGES;

  const [textPages, rasterResult] = await Promise.all([
    loadPdfPages(buffer, { maxPages }),
    rasterizePdfPages(buffer, { maxPages }).catch((error) => {
      errors.push(
        error instanceof Error
          ? `Sayfa raster hatası: ${error.message}`
          : "Sayfa raster başarısız.",
      );
      return { pages: [], engine: "none" as const };
    }),
  ]);

  const rasterByPage = new Map(
    rasterResult.pages.map((page) => [page.pageNumber, page]),
  );

  const rawChunks = chunkPagesToRawText(textPages);
  const storedChunks: StoredChunkRef[] = [];
  let storedChunkCount = 0;
  let skippedChunkCount = 0;

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
      const chunkId = await insertYksChunkRecord(supabase, {
        chunk: labeled,
        embedding,
        sourceName,
        sourcePdf: fileName,
        pageStart: raw.pageStart,
        pageEnd: raw.pageEnd,
      });

      storedChunks.push({
        id: chunkId,
        pageStart: raw.pageStart,
        pageEnd: raw.pageEnd,
        topic: labeled.topic,
        subject: labeled.subject,
        curriculum: labeled.curriculum,
        embedding,
      });

      storedChunkCount += 1;
    } catch (error) {
      skippedChunkCount += 1;
      const message =
        error instanceof Error ? error.message : "Chunk işlenemedi.";
      errors.push(`Chunk ${index + 1} (s.${raw.pageStart}): ${message}`);
    }
  });

  let detectedFigureCount = 0;
  let storedFigureCount = 0;
  let skippedFigureCount = 0;
  let chunkFigureLinks = 0;

  const defaultSubject = hintSubject || storedChunks[0]?.subject || "Genel";
  const defaultCurriculum =
    hintCurriculum || storedChunks[0]?.curriculum || "genel";

  for (const textPage of textPages) {
    const rasterPage = rasterByPage.get(textPage.pageNumber);
    if (!rasterPage?.pngBuffer.length) {
      continue;
    }

    let detection;
    try {
      detection = await detectFiguresOnPage(openai, rasterPage.pngBuffer, {
        fileName,
        pageNumber: textPage.pageNumber,
        textHint: textPage.textLayer,
      });
    } catch (error) {
      skippedFigureCount += 1;
      errors.push(
        error instanceof Error
          ? `Sayfa ${textPage.pageNumber} figür tespit: ${error.message}`
          : `Sayfa ${textPage.pageNumber} figür tespit edilemedi.`,
      );
      continue;
    }

    if (!detection.isAcademic) continue;

    const pageChunks = chunksForPage(storedChunks, textPage.pageNumber);
    const pageSubject = pageChunks[0]?.subject || defaultSubject;
    const pageCurriculum = pageChunks[0]?.curriculum || defaultCurriculum;
    const pageTopic =
      pageChunks[0]?.topic ||
      detection.figures[0]?.relatedTopics[0] ||
      "Genel";

    let figureIndex = 0;

    for (const figure of detection.figures) {
      detectedFigureCount += 1;
      try {
        const result = await persistFigureRegion(supabase, openai, {
          region: figure,
          figureType: figure.figureType,
          caption: figure.caption,
          pagePng: rasterPage.pngBuffer,
          pageWidth: rasterPage.width,
          pageHeight: rasterPage.height,
          pageNumber: textPage.pageNumber,
          figureIndex: figureIndex++,
          fileName,
          sourceName,
          subject: pageSubject,
          curriculum: pageCurriculum,
          topic: figure.relatedTopics[0] || pageTopic,
          relatedTopics: figure.relatedTopics,
          storedChunks,
        });

        if (result.stored) {
          storedFigureCount += 1;
          chunkFigureLinks += result.links;
        } else {
          skippedFigureCount += 1;
        }
      } catch (error) {
        skippedFigureCount += 1;
        errors.push(
          error instanceof Error
            ? `Sayfa ${textPage.pageNumber} figür kayıt: ${error.message}`
            : `Sayfa ${textPage.pageNumber} figür kaydedilemedi.`,
        );
      }
    }

    for (const question of detection.questions) {
      detectedFigureCount += 1;
      try {
        const result = await persistFigureRegion(supabase, openai, {
          region: question,
          figureType: "question",
          caption: question.textPreview,
          pagePng: rasterPage.pngBuffer,
          pageWidth: rasterPage.width,
          pageHeight: rasterPage.height,
          pageNumber: textPage.pageNumber,
          figureIndex: figureIndex++,
          fileName,
          sourceName,
          subject: pageSubject,
          curriculum: pageCurriculum,
          topic: pageTopic,
          storedChunks,
        });

        if (result.stored) {
          storedFigureCount += 1;
          chunkFigureLinks += result.links;
        } else {
          skippedFigureCount += 1;
        }
      } catch (error) {
        skippedFigureCount += 1;
        errors.push(
          error instanceof Error
            ? `Sayfa ${textPage.pageNumber} soru kayıt: ${error.message}`
            : `Sayfa ${textPage.pageNumber} soru kaydedilemedi.`,
        );
      }
    }
  }

  return {
    fileName,
    processedPageCount: textPages.length,
    rasterEngine: rasterResult.engine,
    rawChunkCount: rawChunks.length,
    storedChunkCount,
    skippedChunkCount,
    detectedFigureCount,
    storedFigureCount,
    skippedFigureCount,
    chunkFigureLinks,
    errors,
  };
}
