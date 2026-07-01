import type {
  AcademicPageAnalysis,
  AcademicPageVisual,
} from "@/lib/academic-ingestion/types";

function normalizeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function parseBoundingBox(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;

  const nums = raw.map((value) => Number(value));
  if (nums.some((value) => !Number.isFinite(value))) return null;

  let [xmin, ymin, xmax, ymax] = nums;

  const maxCoord = Math.max(xmin, ymin, xmax, ymax);
  if (maxCoord > 1) {
    xmin /= maxCoord;
    ymin /= maxCoord;
    xmax /= maxCoord;
    ymax /= maxCoord;
  }

  xmin = Math.min(Math.max(xmin, 0), 1);
  ymin = Math.min(Math.max(ymin, 0), 1);
  xmax = Math.min(Math.max(xmax, 0), 1);
  ymax = Math.min(Math.max(ymax, 0), 1);

  if (xmax <= xmin || ymax <= ymin) return null;

  return [xmin, ymin, xmax, ymax];
}

function parseVisual(raw: unknown): AcademicPageVisual | null {
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const description = normalizeString(record.description);
  if (!description) return null;

  const type = normalizeString(record.type, "figure");
  const boundingBox = parseBoundingBox(record.bounding_box);

  return {
    type,
    description,
    boundingBox,
  };
}

export function parseAcademicPageAnalysis(raw: unknown): AcademicPageAnalysis | null {
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const summary = normalizeString(record.summary);
  const textContent = normalizeString(record.text_content);
  const isAcademic = record.is_academic === true;

  const questions = Array.isArray(record.questions)
    ? record.questions
        .map((item) => normalizeString(item))
        .filter(Boolean)
    : [];

  const visuals = Array.isArray(record.visuals)
    ? record.visuals
        .map((item) => parseVisual(item))
        .filter((item): item is AcademicPageVisual => item !== null)
    : [];

  if (!summary && !textContent && !questions.length && !visuals.length) {
    return null;
  }

  return {
    summary,
    textContent,
    questions,
    visuals,
    isAcademic,
    isComplete: record.is_complete !== false,
    trailingFragment: normalizeString(record.trailing_fragment),
  };
}

export function deriveTopicFromAnalysis(analysis: AcademicPageAnalysis): string {
  if (analysis.summary) {
    const firstSentence = analysis.summary.split(/[.!?]\s/)[0]?.trim();
    if (firstSentence && firstSentence.length <= 80) {
      return firstSentence;
    }
    return analysis.summary.slice(0, 80).trim();
  }

  if (analysis.visuals[0]?.description) {
    return analysis.visuals[0].description.slice(0, 80).trim();
  }

  return "Akademik içerik";
}

export function deriveSubTopicFromVisual(visual: AcademicPageVisual): string {
  return `${visual.type}: ${visual.description.slice(0, 60)}`.trim();
}
