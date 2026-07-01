export const EDUCATION_LEVELS = [
  "high_school",
  "university",
  "unknown",
] as const;

export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export function normalizeEducationLevel(value: string): EducationLevel {
  const normalized = value.trim().toLowerCase();

  if (
    normalized === "high_school" ||
    normalized.includes("lise") ||
    normalized.includes("tyt") ||
    normalized.includes("ayt") ||
    normalized.includes("yks") ||
    normalized.includes("lgs")
  ) {
    return "high_school";
  }

  if (
    normalized === "university" ||
    normalized.includes("üniversite") ||
    normalized.includes("universite") ||
    normalized.includes("fakülte") ||
    normalized.includes("fakulte") ||
    normalized.includes("vize") ||
    normalized.includes("final")
  ) {
    return "university";
  }

  if (normalized === "unknown" || normalized.includes("belirsiz")) {
    return "unknown";
  }

  return "unknown";
}

export function parseEducationLevelPayload(
  raw: unknown,
): EducationLevel | null {
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const value = String(record.educationLevel ?? record.level ?? "");

  if (!value.trim()) return null;

  return normalizeEducationLevel(value);
}

/** Supervisor yönlendirme hedefleri */
export type SupervisorRouteTarget = "high_school" | "university";

export function resolveSupervisorRoute(
  educationLevel: EducationLevel,
): SupervisorRouteTarget {
  if (educationLevel === "university") {
    return "university";
  }

  // unknown ve high_school → mevcut lise içerik departmanı
  return "high_school";
}
