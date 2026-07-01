import type { LoadedPdfPage } from "@/lib/academic-ingestion/types";
import type { RawTextChunk } from "@/lib/yks-chunks/types";

const QUESTION_MARKER_RE =
  /(?:^|\n)\s*(?:Soru\s*)?(\d{1,3})[\.\):\-]\s+/g;

const MIN_QUESTION_CHARS = 60;

function pageForOffset(
  pages: LoadedPdfPage[],
  offset: number,
): { pageStart: number; pageEnd: number } {
  let cursor = 0;
  for (const page of pages) {
    const len = page.textLayer.length + 2;
    if (offset < cursor + len) {
      return { pageStart: page.pageNumber, pageEnd: page.pageNumber };
    }
    cursor += len;
  }
  const last = pages[pages.length - 1]?.pageNumber ?? 1;
  return { pageStart: last, pageEnd: last };
}

/** Soru PDF metnini numaralı soru bloklarına böler. */
export function chunkPagesToQuestions(pages: LoadedPdfPage[]): RawTextChunk[] {
  const pageTexts = pages
    .map((page) => page.textLayer.trim())
    .filter(Boolean);

  if (!pageTexts.length) return [];

  const combined = pageTexts.join("\n\n");
  const markers: { index: number; number: number }[] = [];

  for (const match of combined.matchAll(QUESTION_MARKER_RE)) {
    const number = Number(match[1]);
    const index = match.index ?? 0;
    if (Number.isFinite(number) && number > 0) {
      markers.push({ index, number });
    }
  }

  if (markers.length < 2) {
    return combined.length >= MIN_QUESTION_CHARS
      ? [
          {
            text: combined.slice(0, 2200),
            pageStart: pages[0]?.pageNumber ?? 1,
            pageEnd: pages[pages.length - 1]?.pageNumber ?? 1,
          },
        ]
      : [];
  }

  const chunks: RawTextChunk[] = [];

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const end = markers[i + 1]?.index ?? combined.length;
    const text = combined.slice(start, end).trim();

    if (text.length < MIN_QUESTION_CHARS) continue;

    const { pageStart, pageEnd } = pageForOffset(pages, start);
    chunks.push({
      text: text.slice(0, 2800),
      pageStart,
      pageEnd,
    });
  }

  return chunks;
}
