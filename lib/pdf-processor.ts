import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { analyzeAcademicPage } from "@/lib/academic-ingestion/openai-page-analyzer";
import { resolveSequentialContext } from "@/lib/academic-ingestion/context-reconstruction";
import {
  createTextPlaceholderImage,
  groupExtractedImagesByPage,
} from "@/lib/academic-ingestion/page-images";
import {
  deriveSubTopicFromVisual,
  deriveTopicFromAnalysis,
} from "@/lib/academic-ingestion/page-schema";
import type {
  AcademicPageAnalysis,
  AcademicPageMetadata,
  LoadedPdfPage,
} from "@/lib/academic-ingestion/types";
import { ACADEMIC_INGESTION_MAX_PAGES } from "@/lib/academic-ingestion/constants";
import { loadPdfPages } from "@/lib/pdf-page-render";
import { extractImagesFromPdfBuffer } from "@/lib/pdf-image-extract";
import { createAcademicNotesImageEmbedding } from "@/lib/notes-images/embed";
import { insertNotesImageRecord } from "@/lib/notes-images/repository";
import {
  buildNotesImageStoragePath,
  uploadNotesImageToStorage,
} from "@/lib/notes-images/storage";
import type { PdfExtractedImage, PdfProcessorResult } from "@/lib/notes-images/types";

export interface ProcessPdfOptions {
  buffer: Buffer;
  fileName: string;
  supabase: SupabaseClient;
  openai: OpenAI;
  maxPages?: number;
}

interface PendingPageEntry {
  page: LoadedPdfPage;
  analysis: AcademicPageAnalysis;
  embeddedImages: PdfExtractedImage[];
}

function buildPageMetadata(
  analysis: AcademicPageAnalysis,
  contentText: string,
  visualType?: string,
): AcademicPageMetadata {
  return {
    summary: analysis.summary,
    questions: analysis.questions,
    visual_type: visualType,
    page_context: contentText.slice(0, 2000),
    source_pipeline: "academic_ingestion",
  };
}

function resolveImageForVisual(
  embeddedImages: PdfExtractedImage[],
  visualIndex: number,
): PdfExtractedImage | null {
  if (embeddedImages[visualIndex]) {
    return embeddedImages[visualIndex];
  }
  return embeddedImages[0] ?? null;
}

async function persistVisualRecords(
  supabase: SupabaseClient,
  openai: OpenAI,
  fileName: string,
  entry: PendingPageEntry,
  contentText: string,
  pageTopic: string,
  pageMetadata: AcademicPageMetadata,
): Promise<number> {
  let stored = 0;

  for (let visualIndex = 0; visualIndex < entry.analysis.visuals.length; visualIndex++) {
    const visual = entry.analysis.visuals[visualIndex];
    const image = resolveImageForVisual(entry.embeddedImages, visualIndex);

    if (!image) {
      continue;
    }

    const storagePath = buildNotesImageStoragePath({
      pdfFileName: fileName,
      pageNumber: entry.page.pageNumber,
      imageIndex: visualIndex,
      extension: image.mimeType === "image/jpeg" ? "jpg" : "png",
    });

    const publicUrl = await uploadNotesImageToStorage(
      supabase,
      storagePath,
      image,
    );

    const description = visual.description;
    const metadata = buildPageMetadata(
      entry.analysis,
      contentText,
      visual.type,
    );
    const embedding = await createAcademicNotesImageEmbedding(openai, {
      description,
      contentText,
      metadata,
    });

    await insertNotesImageRecord(supabase, {
      storagePath,
      publicUrl,
      topic: pageTopic,
      subTopic: deriveSubTopicFromVisual(visual),
      difficulty: "orta",
      formulaContext: visual.type,
      description,
      contentText,
      metadata,
      embedding,
      sourcePdfName: fileName,
      pageNumber: entry.page.pageNumber,
      width: image.width,
      height: image.height,
    });

    stored += 1;
  }

  return stored;
}

async function persistTextOnlyRecord(
  supabase: SupabaseClient,
  openai: OpenAI,
  fileName: string,
  entry: PendingPageEntry,
  contentText: string,
  pageTopic: string,
  pageMetadata: AcademicPageMetadata,
): Promise<number> {
  const image = await createTextPlaceholderImage();
  image.pageNumber = entry.page.pageNumber;

  const storagePath = buildNotesImageStoragePath({
    pdfFileName: fileName,
    pageNumber: entry.page.pageNumber,
    imageIndex: 0,
    extension: "png",
  });

  const publicUrl = await uploadNotesImageToStorage(
    supabase,
    storagePath,
    image,
  );

  const description =
    entry.analysis.summary || contentText.slice(0, 500) || pageTopic;
  const embedding = await createAcademicNotesImageEmbedding(openai, {
    description,
    contentText,
    metadata: pageMetadata,
  });

  await insertNotesImageRecord(supabase, {
    storagePath,
    publicUrl,
    topic: pageTopic,
    subTopic: "Sayfa içeriği",
    difficulty: "orta",
    formulaContext: "—",
    description,
    contentText,
    metadata: pageMetadata,
    embedding,
    sourcePdfName: fileName,
    pageNumber: entry.page.pageNumber,
    width: image.width,
    height: image.height,
  });

  return 1;
}

async function persistEmbeddedOnlyRecords(
  supabase: SupabaseClient,
  openai: OpenAI,
  fileName: string,
  entry: PendingPageEntry,
  contentText: string,
  pageTopic: string,
  pageMetadata: AcademicPageMetadata,
): Promise<number> {
  let stored = 0;

  for (let i = 0; i < entry.embeddedImages.length; i++) {
    const image = entry.embeddedImages[i];
    const description =
      entry.analysis.summary ||
      contentText.slice(0, 500) ||
      `Sayfa ${entry.page.pageNumber} görsel ${i + 1}`;

    const storagePath = buildNotesImageStoragePath({
      pdfFileName: fileName,
      pageNumber: entry.page.pageNumber,
      imageIndex: i,
      extension: image.mimeType === "image/jpeg" ? "jpg" : "png",
    });

    const publicUrl = await uploadNotesImageToStorage(
      supabase,
      storagePath,
      image,
    );

    const embedding = await createAcademicNotesImageEmbedding(openai, {
      description,
      contentText,
      metadata: pageMetadata,
    });

    await insertNotesImageRecord(supabase, {
      storagePath,
      publicUrl,
      topic: pageTopic,
      subTopic: `figure: ${description.slice(0, 60)}`,
      difficulty: "orta",
      formulaContext: "embedded",
      description,
      contentText,
      metadata: pageMetadata,
      embedding,
      sourcePdfName: fileName,
      pageNumber: entry.page.pageNumber,
      width: image.width,
      height: image.height,
    });

    stored += 1;
  }

  return stored;
}

async function persistCompletedSequence(
  supabase: SupabaseClient,
  openai: OpenAI,
  fileName: string,
  sequence: PendingPageEntry[],
  contentText: string,
): Promise<number> {
  if (!sequence.length) return 0;

  const primary = sequence[sequence.length - 1];
  const pageTopic = deriveTopicFromAnalysis(primary.analysis);
  const pageMetadata = buildPageMetadata(primary.analysis, contentText);

  let stored = 0;
  let hasVisuals = false;

  for (const entry of sequence) {
    if (entry.analysis.visuals.length) {
      hasVisuals = true;
      stored += await persistVisualRecords(
        supabase,
        openai,
        fileName,
        entry,
        contentText,
        pageTopic,
        pageMetadata,
      );
    } else if (entry.embeddedImages.length) {
      hasVisuals = true;
      stored += await persistEmbeddedOnlyRecords(
        supabase,
        openai,
        fileName,
        entry,
        contentText,
        pageTopic,
        pageMetadata,
      );
    }
  }

  if (!hasVisuals && (contentText || primary.analysis.questions.length)) {
    stored += await persistTextOnlyRecord(
      supabase,
      openai,
      fileName,
      primary,
      contentText,
      pageTopic,
      pageMetadata,
    );
  }

  return stored;
}

/**
 * Akademik İçerik İşleme + Sequential Context Reconstruction:
 * Metin katmanı + gömülü görseller; tam sayfa canvas render kullanılmaz.
 */
export async function processPdfForImageRag(
  options: ProcessPdfOptions,
): Promise<PdfProcessorResult> {
  const { buffer, fileName, supabase, openai } = options;
  const maxPages = options.maxPages ?? ACADEMIC_INGESTION_MAX_PAGES;
  const errors: string[] = [];

  const extractedImages = await extractImagesFromPdfBuffer(buffer);
  const imagesByPage = groupExtractedImagesByPage(extractedImages);
  const pages = await loadPdfPages(buffer, { maxPages });

  let processedPageCount = 0;
  let discardedPageCount = 0;
  let storedImageCount = 0;
  let skippedImageCount = 0;
  let textLength = 0;

  let activeBuffer = "";
  let pendingPages: PendingPageEntry[] = [];

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const isLastPage = index === pages.length - 1;
    const embeddedImages = imagesByPage.get(page.pageNumber) ?? [];

    processedPageCount += 1;
    textLength += page.textLayer.length;

    let analysis: AcademicPageAnalysis;
    try {
      analysis = await analyzeAcademicPage(openai, page, fileName, {
        priorTextBuffer: activeBuffer,
        isLastPage,
        pageImages: embeddedImages,
      });
    } catch (error) {
      skippedImageCount += 1;
      errors.push(
        error instanceof Error
          ? `Sayfa ${page.pageNumber} sayfa analizi: ${error.message}`
          : `Sayfa ${page.pageNumber} analiz edilemedi.`,
      );
      continue;
    }

    if (!analysis.isAcademic) {
      discardedPageCount += 1;
      continue;
    }

    const resolved = resolveSequentialContext(analysis, activeBuffer, {
      isLastPage,
    });
    activeBuffer = resolved.nextBuffer;

    if (!resolved.readyToPersist) {
      pendingPages.push({ page, analysis, embeddedImages });
      continue;
    }

    const sequence = [...pendingPages, { page, analysis, embeddedImages }];
    pendingPages = [];

    const contentText =
      resolved.contentText ||
      analysis.summary ||
      analysis.textContent;

    if (
      !contentText &&
      !analysis.questions.length &&
      !sequence.some(
        (entry) =>
          entry.analysis.visuals.length || entry.embeddedImages.length,
      )
    ) {
      discardedPageCount += 1;
      continue;
    }

    try {
      storedImageCount += await persistCompletedSequence(
        supabase,
        openai,
        fileName,
        sequence,
        contentText,
      );
    } catch (error) {
      skippedImageCount += 1;
      errors.push(
        error instanceof Error
          ? `Sayfa ${page.pageNumber} bütünleşik kayıt: ${error.message}`
          : `Sayfa ${page.pageNumber} kaydı başarısız.`,
      );
    }
  }

  if (activeBuffer.trim()) {
    errors.push(
      `PDF sonunda tamamlanmamış metin kaldı (${activeBuffer.slice(0, 120)}…)`,
    );
  }

  if (pendingPages.length) {
    errors.push(
      `${pendingPages.length} sayfa yarım bağlam nedeniyle kaydedilmedi.`,
    );
  }

  return {
    fileName,
    textLength,
    processedPageCount,
    discardedPageCount,
    extractedImageCount: extractedImages.length,
    storedImageCount,
    skippedImageCount,
    errors,
  };
}
