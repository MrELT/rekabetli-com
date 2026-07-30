import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  normalizeTrialExam,
  normalizeTrialExams,
  readStudentProfileFromUserMeta,
  type NotalStudentProfile,
  type NotalTrialExam,
  type YksArea,
  type YksExam,
} from "@/lib/notal/student-context";
import {
  MAX_TRIAL_ANALYSES,
  normalizeTrialAnalyses,
  type NotalTrialAnalysis,
} from "@/lib/notal/trial-analysis";
import { generatePerformanceCoachLine } from "@/lib/notal/performance-coach";
import { computePerformanceProgress } from "@/lib/notal/performance-progress";

export type StudentProfilePatch = {
  classLevel?: string | null;
  yksArea?: YksArea | null;
  enabledExams?: YksExam[];
  targetRank?: string | null;
  trialExams?: NotalTrialExam[];
  addTrialExam?: NotalTrialExam | null;
  trialAnalyses?: NotalTrialAnalysis[];
  addTrialAnalysis?: NotalTrialAnalysis | null;
  performanceCoachLine?: string | null;
};

function getServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) return null;
  return createSupabaseServerClient();
}

function analysisToLegacyTrialExam(
  analysis: NotalTrialAnalysis,
): NotalTrialExam {
  if (analysis.kind === "branch") {
    const net = analysis.branchNet;
    return {
      name: analysis.name,
      takenAt: analysis.takenAt,
      tytNet: analysis.exam === "TYT" ? net : analysis.tytNet,
      aytNet: analysis.exam === "AYT" ? net : analysis.aytNet,
      ydsNet: analysis.exam === "YDS" ? net : analysis.ydsNet,
    };
  }
  return {
    name: analysis.name,
    takenAt: analysis.takenAt,
    tytNet: analysis.tytNet,
    aytNet: analysis.aytNet,
    ydsNet: analysis.ydsNet,
  };
}

function previewProfileAfterPatch(
  existing: NotalStudentProfile | null,
  patch: StudentProfilePatch,
  userMetaPatch: Record<string, unknown>,
): NotalStudentProfile {
  const base =
    existing ??
    ({
      classLevel: null,
      educationLevel: null,
      yksArea: null,
      enabledExams: [],
      targetRank: null,
      trialExams: [],
      trialAnalyses: [],
      performanceCoachLine: null,
    } satisfies NotalStudentProfile);

  return {
    ...base,
    classLevel:
      patch.classLevel !== undefined && patch.classLevel
        ? patch.classLevel
        : base.classLevel,
    yksArea:
      patch.yksArea !== undefined && patch.yksArea ? patch.yksArea : base.yksArea,
    enabledExams:
      patch.enabledExams !== undefined ? patch.enabledExams : base.enabledExams,
    targetRank:
      patch.targetRank !== undefined && patch.targetRank
        ? patch.targetRank
        : base.targetRank,
    trialExams: Array.isArray(userMetaPatch.notal_trial_exams)
      ? normalizeTrialExams(userMetaPatch.notal_trial_exams)
      : base.trialExams,
    trialAnalyses: Array.isArray(userMetaPatch.notal_trial_analyses)
      ? normalizeTrialAnalyses(userMetaPatch.notal_trial_analyses)
      : base.trialAnalyses,
    performanceCoachLine:
      patch.performanceCoachLine !== undefined
        ? patch.performanceCoachLine
        : base.performanceCoachLine,
  };
}

export async function fetchStudentProfile(
  userId: string,
): Promise<NotalStudentProfile | null> {
  const admin = getServiceRoleClient();
  if (!admin) return null;

  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) {
    console.error("[notal] fetch student profile:", error);
    return null;
  }

  return readStudentProfileFromUserMeta(
    (data.user.user_metadata ?? {}) as Record<string, unknown>,
  );
}

export async function persistStudentProfileUpdate(
  userId: string,
  patch: StudentProfilePatch,
  options?: { signal?: AbortSignal },
): Promise<
  { ok: true; profile: NotalStudentProfile } | { ok: false; error: string }
> {
  const admin = getServiceRoleClient();
  if (!admin) {
    return { ok: false, error: "service_role_not_configured" };
  }

  const existing = await fetchStudentProfile(userId);
  const userMetaPatch: Record<string, unknown> = {};

  if (patch.classLevel !== undefined && patch.classLevel) {
    userMetaPatch.class_level = patch.classLevel;
  }
  if (patch.yksArea !== undefined && patch.yksArea) {
    userMetaPatch.yks_area = patch.yksArea;
  }
  if (patch.enabledExams !== undefined) {
    userMetaPatch.notal_enabled_exams = patch.enabledExams;
  }
  if (patch.targetRank !== undefined && patch.targetRank) {
    userMetaPatch.notal_target_rank = patch.targetRank;
  }

  if (patch.trialExams !== undefined) {
    userMetaPatch.notal_trial_exams = patch.trialExams.slice(0, 3);
  } else if (patch.addTrialExam) {
    const merged = [
      patch.addTrialExam,
      ...(existing?.trialExams ?? []),
    ].slice(0, 3);
    userMetaPatch.notal_trial_exams = merged;
  }

  if (patch.trialAnalyses !== undefined) {
    userMetaPatch.notal_trial_analyses = patch.trialAnalyses.slice(
      0,
      MAX_TRIAL_ANALYSES,
    );
  } else if (patch.addTrialAnalysis) {
    const mergedAnalyses = [
      patch.addTrialAnalysis,
      ...(existing?.trialAnalyses ?? []),
    ].slice(0, MAX_TRIAL_ANALYSES);
    userMetaPatch.notal_trial_analyses = mergedAnalyses;

    // Son deneme olarak Performans kutusuna da yansıt.
    if (!patch.addTrialExam && patch.trialExams === undefined) {
      const legacy = analysisToLegacyTrialExam(patch.addTrialAnalysis);
      userMetaPatch.notal_trial_exams = [
        legacy,
        ...(existing?.trialExams ?? []),
      ].slice(0, 3);
    }
  }

  if (patch.performanceCoachLine !== undefined) {
    userMetaPatch.notal_performance_coach_line = patch.performanceCoachLine;
  }

  const trialsChanged = Boolean(
    patch.addTrialExam ||
      patch.trialExams !== undefined ||
      patch.addTrialAnalysis ||
      patch.trialAnalyses !== undefined,
  );
  const targetContextChanged = Boolean(
    (patch.targetRank !== undefined && patch.targetRank) ||
      (patch.yksArea !== undefined && patch.yksArea),
  );

  if (
    patch.performanceCoachLine === undefined &&
    (trialsChanged || targetContextChanged)
  ) {
    const preview = previewProfileAfterPatch(existing, patch, userMetaPatch);
    const progress = computePerformanceProgress(preview);
    if (progress) {
      const line = await generatePerformanceCoachLine(
        progress,
        options?.signal,
      );
      userMetaPatch.notal_performance_coach_line = line;
    }
  }

  if (Object.keys(userMetaPatch).length === 0) {
    return { ok: false, error: "no_valid_context_fields" };
  }

  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: userMetaPatch,
  });

  if (error || !data.user) {
    console.error("[notal] student context update:", error);
    return {
      ok: false,
      error: error?.message || "student_context_update_failed",
    };
  }

  return {
    ok: true,
    profile: readStudentProfileFromUserMeta(
      (data.user.user_metadata ?? {}) as Record<string, unknown>,
    ),
  };
}

export function parseTrialExamPatch(value: unknown): NotalTrialExam | null {
  return normalizeTrialExam(value);
}

export function parseTrialExamsPatch(value: unknown): NotalTrialExam[] {
  return normalizeTrialExams(value);
}
