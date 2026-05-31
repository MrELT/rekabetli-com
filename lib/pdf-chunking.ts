const DEFAULT_MIN = 800;
const DEFAULT_MAX = 1000;

/**
 * Metni ~1000 karakterlik parçalara böler; mümkünse paragraf/cümle sınırında keser.
 */
export function chunkText(
  text: string,
  minSize = DEFAULT_MIN,
  maxSize = DEFAULT_MAX,
): string[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \u00a0]{2,}/g, " ")
    .trim();

  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + maxSize, normalized.length);

    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      let breakAt = slice.lastIndexOf("\n\n");

      if (breakAt < minSize) {
        const sentenceEnd = slice.lastIndexOf(". ");
        if (sentenceEnd >= minSize) breakAt = sentenceEnd + 1;
      }
      if (breakAt < minSize) {
        const questionEnd = slice.lastIndexOf("? ");
        if (questionEnd >= minSize) breakAt = questionEnd + 1;
      }
      if (breakAt < minSize) {
        const exclamEnd = slice.lastIndexOf("! ");
        if (exclamEnd >= minSize) breakAt = exclamEnd + 1;
      }
      if (breakAt < minSize) {
        breakAt = slice.lastIndexOf(" ");
      }
      if (breakAt >= minSize) {
        end = start + breakAt;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk.length >= 50) {
      chunks.push(chunk);
    }
    start = Math.max(end, start + 1);
  }

  return chunks;
}

/** Çok fazla tek-harf satırı veya anlamsız parça — arşive eklenmemeli */
export function isLowQualityChunk(text: string, examMode = false): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < (examMode ? 2 : 3)) return true;

  const shortLines = lines.filter((l) => l.length <= 3).length;
  const shortRatioLimit = examMode ? 0.62 : 0.45;
  if (shortLines / lines.length > shortRatioLimit) return true;

  const words = text.match(/[a-zA-ZüğışöçÜĞİŞÖÇ0-9]{2,}/g) ?? [];
  if (words.length < (examMode ? 3 : 5)) return true;

  const dollarOnly = (text.match(/^\s*\$\s*$/gm) ?? []).length;
  if (dollarOnly >= 2) return true;

  return false;
}

export function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}
