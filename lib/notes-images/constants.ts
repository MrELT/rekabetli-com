/** Görsel RAG eşik değerleri */

export const NOTES_IMAGES_BUCKET = "notes_images";
export const NOTES_IMAGES_MATCH_THRESHOLD = 0.8;
export const NOTES_IMAGES_MATCH_COUNT = 3;
export const NOTES_IMAGES_EMBEDDING_MODEL = "text-embedding-3-small";

/** Vision etiketleme modeli */
export const NOTES_IMAGES_VISION_MODEL =
  process.env.NOTES_IMAGES_VISION_MODEL?.trim() || "gpt-4o-mini";

/** Minimum ayıklanan görsel boyutu (piksel) */
export const NOTES_IMAGES_MIN_DIMENSION = 80;
