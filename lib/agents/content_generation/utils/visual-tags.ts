export type VisualRequestType = "IMAGE" | "MERMAID";

export interface VisualRequest {
  fullTag: string;
  type: VisualRequestType;
  description: string;
}

/**
 * Esnek etiket yakalama:
 * [VISUAL_REQ: IMAGE - açıklama], [VISUAL_REQ:MERMAID-...], boşluk varyasyonları
 * MERMAID etiketleri geriye dönük uyumluluk için IMAGE RAG'e yönlendirilir.
 */
export const VISUAL_REQ_REGEX =
  /\[VISUAL_REQ\s*:\s*(image|mermaid)\s*-\s*([^\]]+)\]/gi;

const GORSELLESTIRME_LINE_REGEX =
  /(?:\n|^)\s*Görselleştirme\s*:[^\n]*(?:\n(?![#*\-\[])[^\n]*)*\s*/gi;

const LEGACY_FALLBACK_TABLE_REGEX =
  /\| Öğe \| Detay \|\n\| --- \| --- \|\n\| Konu \|[^\n]*\|\n\| Not \| Görsel arşivinde[^\n]*\|\n?/gi;

const LEGACY_STEP_TABLE_REGEX =
  /\| Adım \| Açıklama \|\n\| --- \| --- \|\n(?:\| \d+ \|[^\n]*\|\n?)+/gi;

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** Görsel etiketini ve hemen öncesindeki "Görselleştirme:" bloğunu kaldırır. */
export function stripVisualRequestFromDraft(
  draft: string,
  request: VisualRequest,
): string {
  if (!draft.includes(request.fullTag)) return draft;

  const tagIndex = draft.indexOf(request.fullTag);
  const before = draft.slice(0, tagIndex);
  const after = draft.slice(tagIndex + request.fullTag.length);

  const cleanedBefore = before.replace(
    /(?:\n|^)\s*Görselleştirme\s*:[^\n]*(?:\n(?![#*\-\[])[^\n]*)*\s*$/i,
    "",
  );

  return collapseBlankLines(cleanedBefore + after);
}

/** Kalan ham etiketleri ve iç sistem mesajlarını temizler. */
export function stripAllRemainingVisualTags(draft: string): string {
  let updated = draft.replace(
    new RegExp(VISUAL_REQ_REGEX.source, VISUAL_REQ_REGEX.flags),
    "",
  );

  updated = updated.replace(GORSELLESTIRME_LINE_REGEX, "\n");
  updated = updated.replace(LEGACY_FALLBACK_TABLE_REGEX, "");
  updated = updated.replace(LEGACY_STEP_TABLE_REGEX, "");

  return collapseBlankLines(updated);
}

export function extractVisualRequests(draft: string): VisualRequest[] {
  const requests: VisualRequest[] = [];
  const regex = new RegExp(VISUAL_REQ_REGEX.source, VISUAL_REQ_REGEX.flags);

  for (const match of draft.matchAll(regex)) {
    const fullTag = match[0];
    const rawType = match[1]?.trim().toUpperCase();
    const description = match[2]?.trim();

    if (!fullTag || !rawType || !description) continue;
    if (rawType !== "MERMAID" && rawType !== "IMAGE") continue;

    requests.push({
      fullTag,
      type: rawType === "MERMAID" ? "MERMAID" : "IMAGE",
      description,
    });
  }

  return requests;
}

export interface VisualReplacement {
  tag: string;
  markdown: string;
}

export function applyVisualReplacements(
  draft: string,
  replacements: VisualReplacement[],
): string {
  let updated = draft;

  for (const replacement of replacements) {
    if (!replacement.tag || !replacement.markdown) continue;
    updated = updated.split(replacement.tag).join(replacement.markdown);
  }

  return updated;
}

/** @deprecated Görsel yoksa nota hiçbir şey eklenmez; stripAllRemainingVisualTags kullanın. */
export function replaceRemainingVisualTags(draft: string): string {
  return stripAllRemainingVisualTags(draft);
}
