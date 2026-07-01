import { randomUUID } from "node:crypto";

import { isPdfTextUnreadable } from "@/lib/agents/exam_prep/scanned-detect";
import { buildPdfTextSample } from "@/lib/agents/exam_prep/pdf-sample";
import type {
  StudentPdfCategory,
  StudentPdfInput,
  StudentPdfPageImage,
} from "@/lib/agents/exam_prep/types";
import {
  EXAM_PREP_MAX_VISION_PAGES,
  EXAM_PREP_VISION_DPI,
} from "@/lib/exam-prep/constants";
import { rasterizePdfPages } from "@/lib/pdf-page-raster";

export async function prepareStudentPdfFromBuffer(
  buffer: Buffer,
  fileName: string,
  category: StudentPdfCategory,
  id: string = randomUUID(),
): Promise<StudentPdfInput> {
  const { textSample, pageCount } = await buildPdfTextSample(buffer);

  if (!isPdfTextUnreadable(textSample, pageCount)) {
    return {
      id,
      fileName,
      category,
      textSample,
      pageCount,
      readMode: "text",
    };
  }

  const { pages, engine } = await rasterizePdfPages(buffer, {
    maxPages: EXAM_PREP_MAX_VISION_PAGES,
    dpi: EXAM_PREP_VISION_DPI,
  });

  if (!pages.length) {
    throw new Error(
      "PDF taranmış görünüyor ancak sayfa görseli üretilemedi (Poppler/pdf.js).",
    );
  }

  const pageImages: StudentPdfPageImage[] = pages.map((page) => ({
    pageNumber: page.pageNumber,
    pngBase64: page.pngBuffer.toString("base64"),
  }));

  return {
    id,
    fileName,
    category,
    textSample:
      textSample.trim() ||
      `[Taranmış PDF — ${pageImages.length} sayfa görsel analiz (${engine})]`,
    pageCount: pageImages.length,
    readMode: "vision",
    pageImages,
    rasterEngine: engine,
  };
}
