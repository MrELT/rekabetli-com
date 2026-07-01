/** Zorunlu Vision etiketleme şeması (geriye dönük uyumluluk) */

export interface NotesImageLabel {

  topic: string;

  sub_topic: string;

  difficulty: string;

  formula_context: string;

  description: string;

}



export interface NotesImageMetadata {

  summary?: string;

  questions?: string[];

  visual_type?: string;

  page_context?: string;

  source_pipeline?: string;

  [key: string]: unknown;

}



export interface NotesImageRecord {

  id: string;

  storage_path: string;

  public_url: string;

  topic: string;

  sub_topic: string;

  difficulty: string;

  formula_context: string;

  description: string;

  content_text: string;

  metadata: NotesImageMetadata;

  labels: NotesImageLabel;

  source_pdf_name: string | null;

  page_number: number | null;

  width: number | null;

  height: number | null;

}



export interface NotesImageMatch {

  id: string;

  public_url: string;

  topic: string;

  sub_topic: string;

  difficulty: string;

  formula_context: string;

  description: string;

  content_text: string;

  metadata: NotesImageMetadata;

  similarity: number;

}



export interface PdfExtractedImage {

  pageNumber: number;

  imageIndex: number;

  width: number;

  height: number;

  mimeType: "image/png" | "image/jpeg";

  buffer: Buffer;

}



export interface PdfProcessorResult {

  fileName: string;

  textLength: number;

  processedPageCount: number;

  discardedPageCount: number;

  extractedImageCount: number;

  storedImageCount: number;

  skippedImageCount: number;

  errors: string[];

}



export interface AcademicEmbeddingInput {

  description: string;

  contentText: string;

  metadata: NotesImageMetadata;

}


