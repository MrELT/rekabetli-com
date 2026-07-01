export const EXAM_PREP_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const EXAM_PREP_MAX_FILES_PER_CATEGORY = 8;
export const EXAM_PREP_MAX_PAGES_SAMPLE = 25;
export const EXAM_PREP_MAX_TEXT_CHARS = 14_000;

/** Taranmış PDF tespiti: sayfa başına minimum karakter */
export const EXAM_PREP_MIN_CHARS_PER_PAGE = 90;

/** Vision ile okunacak maksimum sayfa (maliyet kontrolü) */
export const EXAM_PREP_MAX_VISION_PAGES = 10;

/** Tek vision isteğinde en fazla sayfa görseli */
export const EXAM_PREP_VISION_BATCH_SIZE = 6;

export const EXAM_PREP_VISION_DPI = Number(
  process.env.EXAM_PREP_VISION_DPI ?? process.env.YKS_PAGE_RENDER_DPI ?? "150",
);

/** Metin PDF'lerinde Supabase'e yazılacak maksimum sayfa */
export const EXAM_PREP_PERSIST_MAX_PAGES = Number(
  process.env.EXAM_PREP_PERSIST_MAX_PAGES ?? "50",
);

/** Persistence sırasında eşzamanlı chunk etiketleme */
export const EXAM_PREP_PERSIST_CONCURRENCY = Math.max(
  1,
  Number(process.env.EXAM_PREP_PERSIST_CONCURRENCY ?? "1"),
);

/** Taranmış soru sayfalarında eşzamanlı işlenecek sayfa sayısı */
export const EXAM_PREP_VISION_PAGE_CONCURRENCY = Math.max(
  1,
  Number(process.env.EXAM_PREP_VISION_PAGE_CONCURRENCY ?? "2"),
);
