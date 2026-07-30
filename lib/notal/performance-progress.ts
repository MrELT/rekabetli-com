import type {
  NotalStudentProfile,
  NotalTrialExam,
  YksArea,
} from "@/lib/notal/student-context";
import type { NotalTrialAnalysis } from "@/lib/notal/trial-analysis";
import {
  estimateTargetNets,
  type TargetNetEstimate,
} from "@/lib/notal/target-nets";

export type PerformanceProgress = {
  sampleCount: number;
  sampleLabel: string;
  avgTyt: number | null;
  avgAyt: number | null;
  avgYds: number | null;
  target: TargetNetEstimate;
  gapTyt: number | null;
  gapAyt: number | null;
  gapYds: number | null;
  /** 0–100; hedefe göre başarı oranı */
  successPercent: number;
  area: YksArea;
  targetRank: string;
};

type NetSample = {
  tytNet: number | null;
  aytNet: number | null;
  ydsNet: number | null;
};

function avgOf(values: number[]): number | null {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

function gap(avg: number | null, target: number | null): number | null {
  if (avg === null || target === null) return null;
  return Math.max(0, Math.round((target - avg) * 10) / 10);
}

function pickGeneralSamples(
  analyses: NotalTrialAnalysis[],
  trialExams: NotalTrialExam[],
): { samples: NetSample[]; sampleLabel: string } {
  const general = analyses.filter((item) => item.kind === "general").slice(0, 3);
  if (general.length > 0) {
    return {
      samples: general.map((item) => ({
        tytNet: item.tytNet,
        aytNet: item.aytNet,
        ydsNet: item.ydsNet,
      })),
      sampleLabel:
        general.length >= 3
          ? "son 3 genel deneme"
          : `son ${general.length} genel deneme`,
    };
  }

  const exams = trialExams.slice(0, 3);
  return {
    samples: exams.map((item) => ({
      tytNet: item.tytNet,
      aytNet: item.aytNet,
      ydsNet: item.ydsNet,
    })),
    sampleLabel:
      exams.length >= 3
        ? "son 3 deneme"
        : exams.length
          ? `son ${exams.length} deneme`
          : "deneme yok",
  };
}

function successFromPairs(
  pairs: Array<{ avg: number | null; target: number | null }>,
): number | null {
  const ratios: number[] = [];
  for (const pair of pairs) {
    if (pair.avg === null || pair.target === null || pair.target <= 0) continue;
    ratios.push(Math.min(1, pair.avg / pair.target));
  }
  if (!ratios.length) return null;
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return Math.round(mean * 100);
}

export function computePerformanceProgress(
  profile: Pick<
    NotalStudentProfile,
    "yksArea" | "targetRank" | "trialExams" | "trialAnalyses"
  >,
): PerformanceProgress | null {
  const area = profile.yksArea;
  const targetRank = profile.targetRank;
  if (!area || !targetRank) return null;

  const target = estimateTargetNets(targetRank, area);
  if (!target) return null;

  const { samples, sampleLabel } = pickGeneralSamples(
    profile.trialAnalyses ?? [],
    profile.trialExams ?? [],
  );
  if (!samples.length) return null;

  const avgTyt = avgOf(
    samples
      .map((s) => s.tytNet)
      .filter((n): n is number => n !== null),
  );
  const avgAyt = avgOf(
    samples
      .map((s) => s.aytNet)
      .filter((n): n is number => n !== null),
  );
  const avgYds = avgOf(
    samples
      .map((s) => s.ydsNet)
      .filter((n): n is number => n !== null),
  );

  if (avgTyt === null && avgAyt === null && avgYds === null) return null;

  const targetYds = target.ydtNet;
  const successPercent =
    successFromPairs([
      { avg: avgTyt, target: target.tytNet },
      { avg: avgAyt, target: target.aytNet },
      { avg: avgYds, target: targetYds },
    ]) ?? 0;

  return {
    sampleCount: samples.length,
    sampleLabel,
    avgTyt,
    avgAyt,
    avgYds,
    target,
    gapTyt: gap(avgTyt, target.tytNet),
    gapAyt: gap(avgAyt, target.aytNet),
    gapYds: gap(avgYds, targetYds),
    successPercent,
    area,
    targetRank,
  };
}

export function formatAverageNets(progress: PerformanceProgress): string {
  const parts: string[] = [];
  if (progress.avgTyt !== null) parts.push(`TYT ${progress.avgTyt}`);
  if (progress.avgAyt !== null) parts.push(`AYT ${progress.avgAyt}`);
  if (progress.avgYds !== null) {
    parts.push(
      `${progress.area === "Dil" ? "YDT" : "YDS"} ${progress.avgYds}`,
    );
  }
  return parts.join(" · ") || "Net yok";
}

export function formatGapNets(progress: PerformanceProgress): string {
  const parts: string[] = [];
  if (progress.gapTyt !== null && progress.gapTyt > 0) {
    parts.push(`TYT +${progress.gapTyt}`);
  }
  if (progress.gapAyt !== null && progress.gapAyt > 0) {
    parts.push(`AYT +${progress.gapAyt}`);
  }
  if (progress.gapYds !== null && progress.gapYds > 0) {
    parts.push(
      `${progress.area === "Dil" ? "YDT" : "YDS"} +${progress.gapYds}`,
    );
  }
  return parts.length ? parts.join(" · ") : "Hedef net bandındasın";
}
