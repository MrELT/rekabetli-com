import {
  EXAM_PREP_MIN_CHARS_PER_PAGE,
} from "@/lib/exam-prep/constants";

/** PDF metin katmanının okunamaz / taranmış olduğunu sezgisel tespit eder. */
export function isPdfTextUnreadable(
  textSample: string,
  pageCount: number,
): boolean {
  const normalized = textSample.replace(/\s+/g, " ").trim();
  if (!normalized) return true;

  const pages = Math.max(pageCount, 1);
  const charsPerPage = normalized.length / pages;
  if (charsPerPage < EXAM_PREP_MIN_CHARS_PER_PAGE) return true;

  const meaningful = (
    normalized.match(/[a-zA-ZçğıöşüÇĞİÖŞÜ0-9]/g) ?? []
  ).length;
  const meaningfulRatio = meaningful / normalized.length;
  if (meaningfulRatio < 0.28) return true;

  const words = normalized.split(" ").filter((w) => w.length >= 3);
  if (words.length < pages * 8) return true;

  return false;
}
