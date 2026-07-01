export {
  NOTES_IMAGES_BUCKET,
  NOTES_IMAGES_MATCH_THRESHOLD,
  NOTES_IMAGES_MATCH_COUNT,
} from "@/lib/notes-images/constants";
export type {
  NotesImageLabel,
  NotesImageMatch,
  PdfProcessorResult,
} from "@/lib/notes-images/types";
export {
  parseNotesImageLabel,
  buildLabelEmbeddingText,
  NOTES_IMAGE_LABEL_JSON_SCHEMA,
} from "@/lib/notes-images/label-schema";
export {
  matchNotesImages,
  buildImageMarkdownFromMatch,
  buildRichMarkdownFromMatch,
} from "@/lib/notes-images/rag";
export {
  buildAcademicEmbeddingText,
  createAcademicNotesImageEmbedding,
} from "@/lib/notes-images/embed";
