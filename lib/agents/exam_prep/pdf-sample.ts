import { loadPdfPages } from "@/lib/pdf-page-render";
import {
  EXAM_PREP_MAX_PAGES_SAMPLE,
  EXAM_PREP_MAX_TEXT_CHARS,
} from "@/lib/exam-prep/constants";

export async function buildPdfTextSample(
  buffer: Buffer,
): Promise<{ textSample: string; pageCount: number }> {
  const pages = await loadPdfPages(buffer, {
    maxPages: EXAM_PREP_MAX_PAGES_SAMPLE,
  });

  const combined = pages
    .map((page) => `--- Sayfa ${page.pageNumber} ---\n${page.textLayer}`)
    .join("\n\n")
    .trim();

  return {
    textSample: combined.slice(0, EXAM_PREP_MAX_TEXT_CHARS),
    pageCount: pages.length,
  };
}
