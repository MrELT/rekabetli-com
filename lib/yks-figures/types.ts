export const YKS_FIGURE_TYPES = [
  "diagram",
  "graph",
  "table",
  "question",
  "photo",
  "other",
] as const;

export type YksFigureType = (typeof YKS_FIGURE_TYPES)[number];

export type NormalizedBbox = [number, number, number, number];

export interface DetectedFigureRegion {
  figureType: YksFigureType;
  bbox: NormalizedBbox;
  caption: string;
  relatedTopics: string[];
}

export interface DetectedQuestionRegion {
  bbox: NormalizedBbox;
  textPreview: string;
  /** Tespit aşamasında tüm şıkların görünür olduğu iddiası */
  complete?: boolean;
  optionsVisible?: string[];
  index?: number;
}

export interface PageFigureDetection {
  figures: DetectedFigureRegion[];
  questions: DetectedQuestionRegion[];
  isAcademic: boolean;
}

export interface YksFigureMatch {
  id: string;
  figureType: string;
  subject: string;
  curriculum: string;
  topic: string;
  caption: string;
  publicUrl: string;
  pageNumber: number;
  sourceName: string | null;
  similarity: number;
  linkScore?: number;
}

export interface StoredChunkRef {
  id: string;
  pageStart: number;
  pageEnd: number;
  topic: string;
  subject: string;
  curriculum: string;
  embedding: number[];
}
