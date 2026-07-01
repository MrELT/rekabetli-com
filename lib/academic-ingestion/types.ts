import type { NotesImageMetadata } from "@/lib/notes-images/types";

export interface AcademicPageVisual {
  type: string;
  description: string;
  boundingBox: [number, number, number, number] | null;
}

export interface AcademicPageAnalysis {
  summary: string;
  textContent: string;
  questions: string[];
  visuals: AcademicPageVisual[];
  isAcademic: boolean;
  isComplete: boolean;
  trailingFragment: string;
}

export interface AcademicPageMetadata extends NotesImageMetadata {
  summary: string;
  questions: string[];
  visual_type?: string;
  page_context?: string;
  source_pipeline: "academic_ingestion";
}

export interface LoadedPdfPage {
  pageNumber: number;
  width: number;
  height: number;
  textLayer: string;
}

/** @deprecated LoadedPdfPage kullanın */
export type RenderedPdfPage = LoadedPdfPage;
