import { YKS_FIGURE_MIN_BBOX_AREA } from "@/lib/yks-figures/constants";
import type { NormalizedBbox } from "@/lib/yks-figures/types";

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Vision yanıtı JSON değil.");
  }
}

export function normalizeBbox(raw: unknown): NormalizedBbox | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const nums = raw.slice(0, 4).map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return null;

  let [xmin, ymin, xmax, ymax] = nums.map((n) => Math.min(1, Math.max(0, n)));
  if (xmax < xmin) [xmin, xmax] = [xmax, xmin];
  if (ymax < ymin) [ymin, ymax] = [ymax, ymin];

  const area = (xmax - xmin) * (ymax - ymin);
  if (area < YKS_FIGURE_MIN_BBOX_AREA) return null;

  return [xmin, ymin, xmax, ymax];
}

export function bboxChanged(
  a: NormalizedBbox,
  b: NormalizedBbox,
  threshold = 0.006,
): boolean {
  return (
    Math.abs(a[0] - b[0]) > threshold ||
    Math.abs(a[1] - b[1]) > threshold ||
    Math.abs(a[2] - b[2]) > threshold ||
    Math.abs(a[3] - b[3]) > threshold
  );
}
