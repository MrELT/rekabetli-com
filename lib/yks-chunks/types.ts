export const YKS_CHUNK_TYPES = [
  "definition",
  "theorem",
  "explanation",
  "example",
  "question",
  "solution",
  "curriculum",
] as const;

export type YksChunkType = (typeof YKS_CHUNK_TYPES)[number];

export const YKS_CURRICULA = ["TYT", "AYT", "genel"] as const;
export type YksCurriculum = (typeof YKS_CURRICULA)[number];

export interface RawTextChunk {
  text: string;
  pageStart: number;
  pageEnd: number;
}

export interface LabeledYksChunk {
  chunkType: YksChunkType;
  subject: string;
  curriculum: YksCurriculum;
  topic: string;
  subtopic: string;
  content: string;
  difficulty: string;
}

export interface YksChunkMatch {
  id: string;
  chunkType: string;
  subject: string;
  curriculum: string;
  topic: string;
  subtopic: string;
  content: string;
  sourceName: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  similarity: number;
}

export interface YksTextIngestResult {
  fileName: string;
  processedPageCount: number;
  rawChunkCount: number;
  storedChunkCount: number;
  skippedChunkCount: number;
  errors: string[];
}
