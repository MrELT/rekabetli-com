export const VALID_SOURCE_TYPES = new Set([
  "book",
  "presentation",
  "exam_question",
  "article",
]);

export type SourceType = "book" | "presentation" | "exam_question" | "article";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const EMBED_BATCH_SIZE = 10;
export const EMBEDDING_MODEL = "text-embedding-3-small";

export function isValidSourceType(value: string): value is SourceType {
  return VALID_SOURCE_TYPES.has(value);
}
