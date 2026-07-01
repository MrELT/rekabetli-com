import OpenAI from "openai";
import {
  ACADEMIC_INGESTION_VISION_MODEL,
  ACADEMIC_PAGE_ANALYSIS_PROMPT,
} from "@/lib/academic-ingestion/constants";
import { parseAcademicPageAnalysis } from "@/lib/academic-ingestion/page-schema";
import type { AcademicPageAnalysis, LoadedPdfPage } from "@/lib/academic-ingestion/types";
import type { PdfExtractedImage } from "@/lib/notes-images/types";

export interface AnalyzeAcademicPageOptions {
  priorTextBuffer?: string;
  isLastPage?: boolean;
  pageImages?: PdfExtractedImage[];
}

function buildUserPrompt(
  page: LoadedPdfPage,
  fileName: string,
  options?: AnalyzeAcademicPageOptions,
): string {
  const priorBuffer = options?.priorTextBuffer?.trim();
  const priorSection = priorBuffer
    ? `\n\nÖNCEKİ SAYFADAN DEVAM EDEN YARIM METİN (bunu bu sayfayla birleştirerek analiz et):\n${priorBuffer.slice(0, 4000)}`
    : "";

  const textLayerHint = page.textLayer
    ? `\n\nSayfadaki metin katmanı (PDF'den çıkarıldı, görselle birlikte değerlendir):\n${page.textLayer.slice(0, 8000)}`
    : "";

  const imageHint = options?.pageImages?.length
    ? `\n\nBu sayfadan ${options.pageImages.length} adet gömülü akademik görsel eklendi; metin katmanıyla birlikte değerlendir.`
    : "\n\nBu sayfada gömülü görsel yok; yalnızca metin katmanına göre analiz et.";

  const completionHint = options?.isLastPage
    ? "\n\nBu PDF'in son sayfasıdır; kalan tüm metni tamamlanmış kabul et (is_complete: true)."
    : "\n\nBu sayfanın sonundaki metin bir soru veya paragrafın devamı mı? Devam ise is_complete: false ve trailing_fragment döndür.";

  return `${ACADEMIC_PAGE_ANALYSIS_PROMPT}${priorSection}${completionHint}${imageHint}\n\nKaynak: ${fileName}, sayfa ${page.pageNumber}.${textLayerHint}`;
}

function extractJsonFromResponse(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Sayfa analizi yanıtı JSON olarak parse edilemedi.");
  }
}

function imageToContentPart(image: PdfExtractedImage) {
  return {
    type: "image_url" as const,
    image_url: {
      url: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`,
    },
  };
}

/** Sayfa metni + gömülü görselleri OpenAI ile analiz eder */
export async function analyzeAcademicPage(
  openai: OpenAI,
  page: LoadedPdfPage,
  fileName: string,
  options?: AnalyzeAcademicPageOptions,
): Promise<AcademicPageAnalysis> {
  const pageImages = (options?.pageImages ?? []).slice(0, 4);
  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: buildUserPrompt(page, fileName, { ...options, pageImages }),
    },
    ...pageImages.map(imageToContentPart),
  ];

  const completion = await openai.chat.completions.create({
    model: ACADEMIC_INGESTION_VISION_MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: userContent }],
  });

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Sayfa analizi boş yanıt döndü.");
  }

  const parsed = extractJsonFromResponse(rawText);
  const analysis = parseAcademicPageAnalysis(parsed);

  if (!analysis) {
    throw new Error("Sayfa analizi şeması geçersiz.");
  }

  return analysis;
}
