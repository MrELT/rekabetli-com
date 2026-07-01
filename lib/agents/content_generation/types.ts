import type { NotalDifficulty } from "@/lib/notal-difficulty";

export const CLASSIFICATION_LEVELS = ["kolay", "orta", "zor"] as const;
export const CLASSIFICATION_CURRICULA = [
  "TYT",
  "AYT",
  "genel müfredat",
] as const;

export type ClassificationLevel = (typeof CLASSIFICATION_LEVELS)[number];
export type ClassificationCurriculum =
  (typeof CLASSIFICATION_CURRICULA)[number];

export interface ClassificationResult {
  intent: string;
  level: ClassificationLevel;
  curriculum: ClassificationCurriculum;
}

export function normalizeClassificationLevel(
  value: string,
): ClassificationLevel {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("kolay") || normalized.includes("easy")) {
    return "kolay";
  }
  if (normalized.includes("zor") || normalized.includes("hard")) {
    return "zor";
  }
  return "orta";
}

export function normalizeClassificationCurriculum(
  value: string,
): ClassificationCurriculum {
  const normalized = value.trim().toUpperCase();
  if (normalized.includes("TYT")) return "TYT";
  if (normalized.includes("AYT")) return "AYT";
  return "genel müfredat";
}

export function normalizeClassificationIntent(value: string): string {
  const trimmed = value.trim();
  return trimmed || "konu anlatımı";
}

export function parseClassificationPayload(
  raw: unknown,
): ClassificationResult | null {
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const intent = normalizeClassificationIntent(String(record.intent ?? ""));
  const level = normalizeClassificationLevel(String(record.level ?? "orta"));
  const curriculum = normalizeClassificationCurriculum(
    String(record.curriculum ?? "genel müfredat"),
  );

  return { intent, level, curriculum };
}

export function classificationLevelToDifficulty(
  level: ClassificationLevel,
): NotalDifficulty {
  return level;
}
