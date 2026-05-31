/**
 * Tarayıcıda pdfjs-dist ile metin çıkarımı (kalite kontrolü + ilk N sayfa).
 */

import {
  hasMinimumExtractedText,
  looksLikeExamPdf,
  minCharsPerPageRequired,
} from "@/lib/pdf-exam-detect";

export interface PdfClientExtractResult {
  fullText: string;
  pageCount: number;
  charsPerPage: number;
  previewText: string;
  previewPageCount: number;
  /** Çıkmış soru / sınav kitapçığı için gevşetilmiş kalite geçildi */
  examMode: boolean;
}

const PREVIEW_MAX_PAGES = 3;

function configureWorker(pdfjs: typeof import("pdfjs-dist")) {
  if (typeof window === "undefined") return;
  const version = pdfjs.version ?? "4.10.38";
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
}

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  configureWorker(pdfjs);
  return pdfjs;
}

async function getPageText(
  page: import("pdfjs-dist").PDFPageProxy,
): Promise<string> {
  const content = await page.getTextContent();
  const parts = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export async function extractPdfInBrowser(
  file: File,
): Promise<PdfClientExtractResult> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pageCount = doc.numPages;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    pageTexts.push(await getPageText(page));
  }

  await doc.destroy();

  const fullText = pageTexts.join("\n\n");
  const totalChars = fullText.replace(/\s/g, "").length;
  const charsPerPage = pageCount > 0 ? totalChars / pageCount : 0;

  const previewPageCount = Math.min(PREVIEW_MAX_PAGES, pageCount);
  const previewText = pageTexts.slice(0, previewPageCount).join("\n\n");

  const examMode = looksLikeExamPdf(fullText);
  const minPerPage = minCharsPerPageRequired(fullText, examMode);

  const passesPerPage = charsPerPage >= minPerPage;
  const passesTotal = hasMinimumExtractedText(totalChars, pageCount, examMode);

  if (!passesPerPage || !passesTotal) {
    if (examMode) {
      throw new Error(
        "PDF'den yeterli metin çıkarılamadı. Çıkmış soru dosyası olsa bile metin katmanı çok zayıf; mümkünse dijital (metin seçilebilir) PDF yükleyin.",
      );
    }
    throw new Error(
      "Bu PDF resim/tarama formatında, lütfen dijital metin içeren bir dosya yükleyin",
    );
  }

  return {
    fullText,
    pageCount,
    charsPerPage,
    previewText,
    previewPageCount,
    examMode,
  };
}
