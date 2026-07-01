export const YKS_CHUNKS_EMBEDDING_MODEL = "text-embedding-3-small";
export const YKS_CHUNKS_MATCH_THRESHOLD = 0.72;
export const YKS_CHUNKS_MATCH_COUNT = 8;

export const YKS_CHUNK_MIN_CHARS = 120;
export const YKS_CHUNK_MAX_CHARS = 2200;
export const YKS_INGESTION_MAX_PAGES = Number(
  process.env.YKS_INGESTION_MAX_PAGES ?? "80",
);

export const YKS_CHUNK_LABEL_MODEL =
  process.env.YKS_CHUNK_LABEL_MODEL?.trim() || "gpt-4o-mini";
