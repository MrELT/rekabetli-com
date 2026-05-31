import type { SourceType } from "@/lib/pdf-ingest-shared";

export interface PdfMetadataJson {
  title: string;
  author: string;
  category: string;
  type: string;
}

/** OpenAI metadata.type → academic_library_chunks.source_type */
export function mapMetadataTypeToSourceType(typeLabel: string): SourceType {
  const t = typeLabel.trim().toLowerCase();
  if (t.includes("çıkmış") || t.includes("soru") || t.includes("sınav") || t.includes("exam")) {
    return "exam_question";
  }
  if (t.includes("sunum") || t.includes("slayt") || t.includes("presentation")) {
    return "presentation";
  }
  if (t.includes("makale") || t.includes("article") || t.includes("paper")) {
    return "article";
  }
  return "book";
}

export function normalizeMetadataPayload(raw: unknown): PdfMetadataJson | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = String(o.title ?? "").trim();
  const author = String(o.author ?? "").trim();
  const category = String(o.category ?? "").trim();
  const type = String(o.type ?? "").trim();
  if (!title && !author) return null;
  return {
    title: title || "İsimsiz Kaynak",
    author: author || "Bilinmeyen",
    category: category || "Genel",
    type: type || "Kitap",
  };
}
