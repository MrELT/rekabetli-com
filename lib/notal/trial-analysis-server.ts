import type { NotalChatAttachmentInput } from "@/lib/notal/chat-attachments";
import { runInsightAgent } from "@/lib/notal/insight/agent";
import { runQuestionSolverAgent } from "@/lib/notal/question-solver/agent";
import { persistStudentProfileUpdate } from "@/lib/notal/student-context-server";
import type { NotalStudentProfile, YksExam } from "@/lib/notal/student-context";
import {
  MAX_TRIAL_ANALYSIS_IMAGES,
  type NotalTrialAnalysis,
  type NotalTrialBranchStat,
  type TrialAnalysisKind,
} from "@/lib/notal/trial-analysis";
import {
  getBranchQuestionCount,
  validateBranchStatsAgainstTotal,
  validateTrialStats,
} from "@/lib/notal/trial-question-counts";

export type CreateTrialAnalysisInput = {
  kind: TrialAnalysisKind;
  exam: YksExam;
  branch?: string | null;
  name?: string | null;
  takenAt?: string | null;
  tytNet?: number | null;
  aytNet?: number | null;
  ydsNet?: number | null;
  branchNet?: number | null;
  wrongCount?: number | null;
  blankCount?: number | null;
  branchStats?: NotalTrialBranchStat[];
  attachments?: Array<
    NotalChatAttachmentInput & {
      mistakeKind?: "wrong" | "blank" | null;
    }
  >;
};

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultName(input: CreateTrialAnalysisInput): string {
  if (input.name?.trim()) return input.name.trim();
  if (input.kind === "branch") {
    return `${input.exam} · ${input.branch || "Branş"} Denemesi`;
  }
  return `${input.exam} Genel Deneme`;
}

function normalizeIncomingBranchStats(
  value: NotalTrialBranchStat[] | undefined,
): NotalTrialBranchStat[] {
  if (!Array.isArray(value)) return [];
  const result: NotalTrialBranchStat[] = [];
  for (const row of value) {
    const branch = typeof row.branch === "string" ? row.branch.trim() : "";
    if (!branch) continue;
    const net =
      typeof row.net === "number" && Number.isFinite(row.net) ? row.net : null;
    const wrongCount =
      typeof row.wrongCount === "number" && Number.isFinite(row.wrongCount)
        ? Math.max(0, Math.round(row.wrongCount))
        : null;
    const blankCount =
      typeof row.blankCount === "number" && Number.isFinite(row.blankCount)
        ? Math.max(0, Math.round(row.blankCount))
        : null;
    if (net === null && wrongCount === null && blankCount === null) continue;
    result.push({ branch, net, wrongCount, blankCount });
  }
  return result.slice(0, 12);
}

export function validateCreateTrialAnalysisInput(
  input: CreateTrialAnalysisInput,
): { ok: true } | { ok: false; error: string } {
  if (input.kind === "branch" && !input.branch?.trim()) {
    return { ok: false, error: "branch_required" };
  }

  const examNet =
    input.exam === "TYT"
      ? (input.tytNet ?? null)
      : input.exam === "AYT"
        ? (input.aytNet ?? null)
        : (input.ydsNet ?? null);

  if (input.kind === "branch") {
    const check = validateTrialStats(
      {
        net: input.branchNet ?? examNet,
        wrongCount: input.wrongCount ?? null,
        blankCount: input.blankCount ?? null,
      },
      getBranchQuestionCount(input.exam, input.branch || ""),
      input.branch || "Branş",
    );
    if (!check.ok) return { ok: false, error: check.error || "invalid_stats" };
    return { ok: true };
  }

  const branchStats = normalizeIncomingBranchStats(input.branchStats);
  const check = validateBranchStatsAgainstTotal({
    exam: input.exam,
    total: {
      net: examNet,
      wrongCount: input.wrongCount ?? null,
      blankCount: input.blankCount ?? null,
    },
    branches: branchStats,
  });
  if (!check.ok) return { ok: false, error: check.error || "invalid_stats" };
  return { ok: true };
}

/**
 * Kaydeder; görsel varsa Luna ile soru çözümü + bilgi kartı üretir.
 */
export async function createTrialAnalysis(options: {
  userId: string;
  input: CreateTrialAnalysisInput;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; analysis: NotalTrialAnalysis; profile: NotalStudentProfile }
  | { ok: false; error: string }
> {
  const { input } = options;
  const validated = validateCreateTrialAnalysisInput(input);
  if (!validated.ok) return validated;

  const branchStats =
    input.kind === "general"
      ? normalizeIncomingBranchStats(input.branchStats)
      : [];

  const attachments = (input.attachments ?? [])
    .filter((item) => item.kind === "image")
    .slice(0, MAX_TRIAL_ANALYSIS_IMAGES);

  for (const item of attachments) {
    if (item.mistakeKind !== "wrong" && item.mistakeKind !== "blank") {
      return { ok: false, error: "Her fotoğraf için yanlış veya boş seçmelisin." };
    }
  }

  const solutions: NotalTrialAnalysis["solutions"] = [];
  const knowledgeCards: NotalTrialAnalysis["knowledgeCards"] = [];

  for (const [index, attachment] of attachments.entries()) {
    if (options.signal?.aborted) {
      return { ok: false, error: "aborted" };
    }

    const mistakeKind = attachment.mistakeKind === "blank" ? "blank" : "wrong";
    const mistakeLabel = mistakeKind === "blank" ? "boş bıraktığı" : "yanlış yaptığı";

    try {
      const solution = await runQuestionSolverAgent({
        exam: input.exam,
        branch: input.branch ?? null,
        topic: input.branch || `${input.exam} deneme sorusu`,
        question: `Bu görsel, öğrencinin ${input.exam}${
          input.branch ? ` · ${input.branch}` : ""
        } denemesinde ${mistakeLabel} sorudur. Soruyu oku, çöz ve konuyu belirle. (Görsel ${index + 1}/${attachments.length})`,
        attachments: [attachment],
        signal: options.signal,
      });

      solutions.push({
        id: solution.id,
        exam: solution.exam,
        branch: solution.branch,
        topic: solution.topic,
        question: solution.question,
        solution: solution.solution,
        finalAnswer: solution.finalAnswer,
        mistakeKind,
      });

      try {
        const card = await runInsightAgent({
          solution,
          signal: options.signal,
        });
        knowledgeCards.push({
          id: card.id,
          exam: card.exam,
          branch: card.branch,
          topic: card.topic,
          title: card.title,
          summary: card.summary,
          keyPoints: card.keyPoints,
          formula: card.formula,
          trap: card.trap,
          sourceSolutionId: card.sourceSolutionId,
        });
      } catch (error) {
        console.error("[notal] trial analysis insight failed:", error);
      }
    } catch (error) {
      console.error("[notal] trial analysis solve failed:", error);
    }
  }

  const analysis: NotalTrialAnalysis = {
    id: createId(),
    kind: input.kind,
    exam: input.exam,
    branch: input.kind === "branch" ? input.branch?.trim() || null : null,
    name: defaultName(input),
    takenAt: input.takenAt?.trim() || null,
    tytNet:
      input.exam === "TYT"
        ? (input.tytNet ?? input.branchNet ?? null)
        : (input.tytNet ?? null),
    aytNet:
      input.exam === "AYT"
        ? (input.aytNet ?? input.branchNet ?? null)
        : (input.aytNet ?? null),
    ydsNet:
      input.exam === "YDS"
        ? (input.ydsNet ?? input.branchNet ?? null)
        : (input.ydsNet ?? null),
    branchNet: input.kind === "branch" ? (input.branchNet ?? null) : null,
    wrongCount: input.wrongCount ?? null,
    blankCount: input.blankCount ?? null,
    branchStats,
    attachmentCount: attachments.length,
    solutions,
    knowledgeCards,
    createdAt: new Date().toISOString(),
  };

  const persist = await persistStudentProfileUpdate(
    options.userId,
    {
      addTrialAnalysis: analysis,
    },
    { signal: options.signal },
  );

  if (!persist.ok) {
    return { ok: false, error: persist.error };
  }

  const saved =
    persist.profile.trialAnalyses.find((item) => item.id === analysis.id) ??
    analysis;

  return { ok: true, analysis: saved, profile: persist.profile };
}
