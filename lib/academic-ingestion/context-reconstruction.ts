import type { AcademicPageAnalysis } from "@/lib/academic-ingestion/types";

/** Önceki sayfadan gelen yarım metin + yeni parça birleştirme */
export function appendToActiveBuffer(buffer: string, fragment: string): string {
  const next = fragment.trim();
  if (!next) return buffer.trim();

  const current = buffer.trim();
  if (!current) return next;

  const needsSpace =
    !current.endsWith("-") &&
    !current.endsWith(" ") &&
    !next.startsWith(" ") &&
    !/^[,.;:!?)}\]'»]/.test(next);

  return needsSpace ? `${current} ${next}` : `${current}${next}`;
}

export interface ResolvedPageContext {
  /** Veritabanına yazılacak tam metin */
  contentText: string;
  /** Sonraki sayfaya taşınacak yarım metin */
  nextBuffer: string;
  /** Bu sayfanın kayıtları yazılabilir mi */
  readyToPersist: boolean;
}

/**
 * activeBuffer + sayfa analizi → kalıcı kayıt metni veya ertelenmiş buffer.
 */
export function resolveSequentialContext(
  analysis: AcademicPageAnalysis,
  activeBuffer: string,
  options?: { isLastPage?: boolean },
): ResolvedPageContext {
  const isLastPage = options?.isLastPage === true;
  const pageText = analysis.textContent.trim();
  const trailing = analysis.trailingFragment.trim();

  if (!analysis.isComplete && !isLastPage) {
    const fragmentForBuffer = trailing || pageText;
    const nextBuffer = appendToActiveBuffer(activeBuffer, fragmentForBuffer);

    const completePrefix = trailing && pageText.endsWith(trailing)
      ? pageText.slice(0, pageText.length - trailing.length).trim()
      : trailing
        ? pageText
        : "";

    const contentText = activeBuffer
      ? appendToActiveBuffer(activeBuffer, completePrefix)
      : completePrefix;

    return {
      contentText,
      nextBuffer,
      readyToPersist: false,
    };
  }

  const mergedPageText = activeBuffer
    ? appendToActiveBuffer(activeBuffer, pageText)
    : pageText;

  const contentText =
    mergedPageText || analysis.summary.trim() || trailing;

  return {
    contentText,
    nextBuffer: "",
    readyToPersist: true,
  };
}
