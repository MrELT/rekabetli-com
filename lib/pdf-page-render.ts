import { configurePdfJsWorker } from "@/lib/pdfjs-server";
import { PDF_PAGE_RENDER_SCALE } from "@/lib/academic-ingestion/constants";
import type { LoadedPdfPage } from "@/lib/academic-ingestion/types";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDocumentProxy = Awaited<
  ReturnType<PdfJsModule["getDocument"]>["promise"]
>;
type PdfPage = Awaited<ReturnType<PdfDocumentProxy["getPage"]>>;

function textItemToString(item: { str?: string } | { type?: string }): string {
  return "str" in item && item.str ? String(item.str) : "";
}

let pdfjsModule: PdfJsModule | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsModule) {
    pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs");
    configurePdfJsWorker(pdfjsModule);
  }

  return pdfjsModule;
}

async function extractPageTextLayer(page: PdfPage): Promise<string> {
  try {
    const textContent = await page.getTextContent();
    return textContent.items
      .map((item) => textItemToString(item))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

/**
 * PDF sayfalarını metin katmanı + boyut bilgisiyle yükler.
 * Tam sayfa canvas render (pdf.js Path2D) Node ortamında güvenilir değil;
 * görseller ayrıca extractImagesFromPdfBuffer ile ayıklanır.
 */
export async function loadPdfPages(
  buffer: Buffer,
  options?: { scale?: number; maxPages?: number },
): Promise<LoadedPdfPage[]> {
  const pdfjs = await loadPdfJs();
  const scale = options?.scale ?? PDF_PAGE_RENDER_SCALE;

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const results: LoadedPdfPage[] = [];
  const pageLimit = options?.maxPages
    ? Math.min(doc.numPages, options.maxPages)
    : doc.numPages;

  try {
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const textLayer = await extractPageTextLayer(page);

      results.push({
        pageNumber,
        width: Math.ceil(viewport.width),
        height: Math.ceil(viewport.height),
        textLayer,
      });
    }
  } finally {
    await doc.destroy();
  }

  return results;
}

/** @deprecated loadPdfPages kullanın */
export const renderPdfPagesToPng = loadPdfPages;
