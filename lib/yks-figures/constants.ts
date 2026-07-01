export const YKS_FIGURES_BUCKET = "yks_figures";
export const YKS_FIGURES_EMBEDDING_MODEL = "text-embedding-3-small";
export const YKS_FIGURES_MATCH_THRESHOLD = 0.72;
export const YKS_FIGURES_MATCH_COUNT = 5;
export const YKS_FIGURES_LINK_THRESHOLD = 0.35;

export const YKS_PAGE_RENDER_DPI = Number(process.env.YKS_PAGE_RENDER_DPI ?? "150");
export const YKS_FIGURE_DETECT_MODEL =
  process.env.YKS_FIGURE_DETECT_MODEL?.trim() || "gpt-4o-mini";

export const YKS_FIGURE_MIN_DIMENSION = 120;
export const YKS_FIGURE_MAX_WHITE_RATIO = 0.88;
export const YKS_FIGURE_MIN_BBOX_AREA = 0.015;
