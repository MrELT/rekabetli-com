import {
  normalizeTrialAnalyses,
  type NotalTrialAnalysis,
} from "@/lib/notal/trial-analysis";

export type YksArea = "Sayısal" | "Eşit Ağırlık" | "Sözel" | "Dil";
export type YksExam = "TYT" | "AYT" | "YDS";

export type NotalTrialExam = {
  name: string;
  takenAt: string | null;
  tytNet: number | null;
  aytNet: number | null;
  ydsNet: number | null;
};

export type NotalStudentProfile = {
  classLevel: string | null;
  educationLevel: string | null;
  yksArea: YksArea | null;
  enabledExams: YksExam[];
  targetRank: string | null;
  trialExams: NotalTrialExam[];
  trialAnalyses: NotalTrialAnalysis[];
  /** Son deneme sonrası kısa motivasyon cümlesi */
  performanceCoachLine: string | null;
};

function isYksArea(value: unknown): value is YksArea {
  return (
    value === "Sayısal" ||
    value === "Eşit Ağırlık" ||
    value === "Sözel" ||
    value === "Dil"
  );
}

function isYksExam(value: unknown): value is YksExam {
  return value === "TYT" || value === "AYT" || value === "YDS";
}

export function normalizeEnabledExams(value: unknown): YksExam[] {
  if (!Array.isArray(value)) return [];
  const result: YksExam[] = [];
  for (const item of value) {
    if (isYksExam(item) && !result.includes(item)) result.push(item);
  }
  return result;
}

function parseNet(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeTrialExam(value: unknown): NotalTrialExam | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const takenAtRaw =
    typeof row.taken_at === "string"
      ? row.taken_at.trim()
      : typeof row.takenAt === "string"
        ? row.takenAt.trim()
        : "";
  const tytNet = parseNet(row.tyt_net ?? row.tytNet);
  const aytNet = parseNet(row.ayt_net ?? row.aytNet);
  const ydsNet = parseNet(row.yds_net ?? row.ydsNet);

  if (!name && tytNet === null && aytNet === null && ydsNet === null) {
    return null;
  }

  return {
    name: name || "Deneme",
    takenAt: takenAtRaw || null,
    tytNet,
    aytNet,
    ydsNet,
  };
}

export function normalizeTrialExams(value: unknown): NotalTrialExam[] {
  if (!Array.isArray(value)) return [];
  const result: NotalTrialExam[] = [];
  for (const item of value) {
    const exam = normalizeTrialExam(item);
    if (exam) result.push(exam);
  }
  return result.slice(0, 3);
}

export function readStudentProfileFromUserMeta(
  userMeta: Record<string, unknown>,
): NotalStudentProfile {
  const classLevel =
    typeof userMeta.class_level === "string" ? userMeta.class_level.trim() : "";
  const educationLevel =
    typeof userMeta.education_level === "string"
      ? userMeta.education_level.trim()
      : "";

  const yksAreaRaw =
    typeof userMeta.yks_area === "string" ? userMeta.yks_area.trim() : null;
  const yksArea = isYksArea(yksAreaRaw) ? yksAreaRaw : null;

  const enabledExams = normalizeEnabledExams(userMeta.notal_enabled_exams);
  const targetRank =
    typeof userMeta.notal_target_rank === "string"
      ? userMeta.notal_target_rank.trim()
      : "";
  const trialExams = normalizeTrialExams(userMeta.notal_trial_exams);
  const trialAnalyses = normalizeTrialAnalyses(userMeta.notal_trial_analyses);
  const performanceCoachLine =
    typeof userMeta.notal_performance_coach_line === "string"
      ? userMeta.notal_performance_coach_line.trim()
      : "";

  return {
    classLevel: classLevel || null,
    educationLevel: educationLevel || null,
    yksArea,
    enabledExams,
    targetRank: targetRank || null,
    trialExams,
    trialAnalyses,
    performanceCoachLine: performanceCoachLine || null,
  };
}
