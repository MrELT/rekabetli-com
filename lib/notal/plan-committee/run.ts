import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computePerformanceProgress,
  formatAverageNets,
  formatGapNets,
} from "@/lib/notal/performance-progress";
import { listPlanBlocksInRange } from "@/lib/notal/planner/repository";
import type { NotalPlanBlock } from "@/lib/notal/planner/types";
import { NOTAL_TZ } from "@/lib/notal/planner/types";
import {
  runExamSpecialist,
  runPdrSpecialist,
} from "@/lib/notal/plan-committee/specialists";
import type {
  PlanCommitteeBrief,
  PlanCommitteeResult,
  SpecialistOpinion,
} from "@/lib/notal/plan-committee/types";
import type {
  NotalStudentProfile,
  YksArea,
  YksExam,
} from "@/lib/notal/student-context";
import {
  estimateTargetNets,
  formatTargetNetHint,
} from "@/lib/notal/target-nets";

function emptyOpinion(role: SpecialistOpinion["role"]): SpecialistOpinion {
  return {
    role,
    risks: [],
    suggestions: [],
    veto: "none",
    vetoReason: "",
  };
}

function formatBlockLine(block: NotalPlanBlock): string {
  const start = new Date(block.start_at).toLocaleString("tr-TR", {
    timeZone: NOTAL_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const end = new Date(block.end_at).toLocaleTimeString("tr-TR", {
    timeZone: NOTAL_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `- ${start}–${end}: ${block.title}`;
}

async function buildCalendarSummary(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 14);
  try {
    const blocks = await listPlanBlocksInRange(
      supabase,
      userId,
      now.toISOString(),
      end.toISOString(),
    );
    if (!blocks.length) return "Önümüzdeki 14 günde kayıtlı plan yok.";
    return blocks.slice(0, 40).map(formatBlockLine).join("\n");
  } catch (error) {
    console.error("[notal] plan committee calendar summary failed:", error);
    return "Takvim özeti alınamadı.";
  }
}

function buildStudentSummary(profile: {
  classLevel?: string | null;
  yksArea?: YksArea | null;
  enabledExams?: YksExam[] | null;
  targetRank?: string | null;
  trialExams?: NotalStudentProfile["trialExams"];
}): string {
  const lines: string[] = [];
  if (profile.classLevel) lines.push(`Sınıf: ${profile.classLevel}`);
  if (profile.yksArea) lines.push(`YKS alanı: ${profile.yksArea}`);
  if (profile.enabledExams?.length) {
    lines.push(`Aktif sınavlar: ${profile.enabledExams.join(", ")}`);
  }
  if (profile.targetRank) lines.push(`Hedef sıralama: ${profile.targetRank}`);
  const targetNets = estimateTargetNets(profile.targetRank, profile.yksArea);
  if (targetNets) {
    lines.push(`Hedef net rehberi: ${formatTargetNetHint(targetNets)}`);
  }
  if (profile.trialExams?.length) {
    lines.push(
      `Son denemeler: ${profile.trialExams
        .map((item) => {
          const parts = [item.name];
          if (item.tytNet !== null) parts.push(`TYT ${item.tytNet}`);
          if (item.aytNet !== null) parts.push(`AYT ${item.aytNet}`);
          if (item.ydsNet !== null) parts.push(`YDS ${item.ydsNet}`);
          return parts.join(" · ");
        })
        .join(" | ")}`,
    );
  }
  return lines.join("\n") || "Profil eksik.";
}

function buildPerformanceSummary(profile: {
  yksArea?: YksArea | null;
  targetRank?: string | null;
  trialExams?: NotalStudentProfile["trialExams"];
  trialAnalyses?: NotalStudentProfile["trialAnalyses"];
}): string {
  const progress = computePerformanceProgress({
    yksArea: profile.yksArea ?? null,
    targetRank: profile.targetRank ?? null,
    trialExams: profile.trialExams ?? [],
    trialAnalyses: profile.trialAnalyses ?? [],
  });
  if (!progress) return "Hedef/deneme karşılaştırması yok.";
  return [
    `Başarı oranı: %${progress.successPercent}`,
    `Ortalama (${progress.sampleLabel}): ${formatAverageNets(progress)}`,
    `Hedefe kalan: ${formatGapNets(progress)}`,
  ].join("\n");
}

/**
 * 1 tur plan komitesi: PDR + sınav uzmanı paralel.
 * Nihai karar ayrı bir LLM çağrısı değil; orkestratör verir.
 */
export async function runPlanCommittee(options: {
  request: string;
  supabase: SupabaseClient;
  userId: string;
  profile: {
    classLevel?: string | null;
    yksArea?: YksArea | null;
    enabledExams?: YksExam[] | null;
    targetRank?: string | null;
    trialExams?: NotalStudentProfile["trialExams"];
    trialAnalyses?: NotalStudentProfile["trialAnalyses"];
  };
  signal?: AbortSignal;
}): Promise<PlanCommitteeResult> {
  const request = options.request.trim();
  if (!request) {
    return {
      ok: false,
      brief: null,
      specialists: {
        pdr: emptyOpinion("pdr"),
        exam: emptyOpinion("exam"),
      },
      hasHardVeto: false,
      error: "missing_request",
    };
  }

  const brief: PlanCommitteeBrief = {
    request,
    studentSummary: buildStudentSummary(options.profile),
    performanceSummary: buildPerformanceSummary(options.profile),
    calendarSummary: await buildCalendarSummary(
      options.supabase,
      options.userId,
    ),
  };

  const [pdr, exam] = await Promise.all([
    runPdrSpecialist({ brief, signal: options.signal }),
    runExamSpecialist({ brief, signal: options.signal }),
  ]);

  return {
    ok: true,
    brief,
    specialists: { pdr, exam },
    hasHardVeto: pdr.veto === "hard" || exam.veto === "hard",
  };
}
