import type { LoadedPdfPage } from "@/lib/academic-ingestion/types";
import {
  YKS_CHUNK_MAX_CHARS,
  YKS_CHUNK_MIN_CHARS,
} from "@/lib/yks-chunks/constants";
import type { RawTextChunk } from "@/lib/yks-chunks/types";

function endsWithSentenceBoundary(text: string): boolean {
  return /[.!?…:]["')\]]*\s*$/.test(text.trim());
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}|\s{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 40);
}

function splitOversized(text: string): string[] {
  if (text.length <= YKS_CHUNK_MAX_CHARS) return [text];

  const sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > YKS_CHUNK_MAX_CHARS && current) {
      parts.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts.length ? parts : [text.slice(0, YKS_CHUNK_MAX_CHARS)];
}

function mergeSmallChunks(chunks: RawTextChunk[]): RawTextChunk[] {
  const merged: RawTextChunk[] = [];

  for (const chunk of chunks) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.text.length < YKS_CHUNK_MIN_CHARS &&
      last.text.length + chunk.text.length <= YKS_CHUNK_MAX_CHARS
    ) {
      last.text = `${last.text} ${chunk.text}`.trim();
      last.pageEnd = chunk.pageEnd;
      continue;
    }
    merged.push({ ...chunk });
  }

  return merged;
}

/** PDF sayfa metinlerini anlamlı ham chunk'lara böler. */
export function chunkPagesToRawText(pages: LoadedPdfPage[]): RawTextChunk[] {
  const chunks: RawTextChunk[] = [];
  let carryBuffer = "";

  for (const page of pages) {
    const pageText = page.textLayer.trim();
    if (!pageText) continue;

    const combined = carryBuffer
      ? `${carryBuffer} ${pageText}`.trim()
      : pageText;

    if (!endsWithSentenceBoundary(combined) && combined.length < YKS_CHUNK_MAX_CHARS) {
      carryBuffer = combined;
      continue;
    }

    carryBuffer = "";
    const paragraphs = splitIntoParagraphs(combined);

    for (const paragraph of paragraphs) {
      for (const part of splitOversized(paragraph)) {
        if (part.length < YKS_CHUNK_MIN_CHARS) {
          carryBuffer = carryBuffer ? `${carryBuffer} ${part}` : part;
          continue;
        }
        chunks.push({
          text: part,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
        });
      }
    }
  }

  if (carryBuffer.trim().length >= YKS_CHUNK_MIN_CHARS) {
    const lastPage = pages[pages.length - 1]?.pageNumber ?? 1;
    chunks.push({
      text: carryBuffer.trim(),
      pageStart: lastPage,
      pageEnd: lastPage,
    });
  }

  return mergeSmallChunks(chunks);
}
