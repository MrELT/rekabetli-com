export type YksExam = "TYT" | "AYT" | "YDS";

export type TrialAnalysisKind = "general" | "branch";

export type NotalTrialAnalysisSolution = {
  id: string;
  exam: YksExam;
  branch: string;
  topic: string;
  question: string;
  solution: string;
  finalAnswer?: string;
};

export type NotalTrialAnalysisCard = {
  id: string;
  exam: YksExam;
  branch: string;
  topic: string;
  title: string;
  summary: string;
  keyPoints: string[];
  formula?: string;
  trap?: string;
  sourceSolutionId?: string;
};

export type NotalTrialAnalysis = {
  id: string;
  kind: TrialAnalysisKind;
  exam: YksExam;
  branch: string | null;
  name: string;
  takenAt: string | null;
  tytNet: number | null;
  aytNet: number | null;
  ydsNet: number | null;
  branchNet: number | null;
  wrongCount: number | null;
  blankCount: number | null;
  attachmentCount: number;
  solutions: NotalTrialAnalysisSolution[];
  knowledgeCards: NotalTrialAnalysisCard[];
  createdAt: string;
};

export const MAX_TRIAL_ANALYSES = 12;
export const MAX_TRIAL_ANALYSIS_IMAGES = 6;

function parseNet(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseCount(value: unknown): number | null {
  const n = parseNet(value);
  if (n === null) return null;
  return Math.max(0, Math.round(n));
}

function isYksExam(value: unknown): value is YksExam {
  return value === "TYT" || value === "AYT" || value === "YDS";
}

function normalizeSolution(value: unknown): NotalTrialAnalysisSolution | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const exam = row.exam;
  if (!isYksExam(exam)) return null;
  const id = typeof row.id === "string" ? row.id : "";
  const branch = typeof row.branch === "string" ? row.branch.trim() : "";
  const topic = typeof row.topic === "string" ? row.topic.trim() : "";
  const question = typeof row.question === "string" ? row.question.trim() : "";
  const solution = typeof row.solution === "string" ? row.solution.trim() : "";
  if (!id || !branch || !topic || !solution) return null;
  return {
    id,
    exam,
    branch,
    topic,
    question: question || "(Soru görselden okundu)",
    solution,
    finalAnswer:
      typeof row.finalAnswer === "string" ? row.finalAnswer.trim() : undefined,
  };
}

function normalizeCard(value: unknown): NotalTrialAnalysisCard | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const exam = row.exam;
  if (!isYksExam(exam)) return null;
  const id = typeof row.id === "string" ? row.id : "";
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const summary = typeof row.summary === "string" ? row.summary.trim() : "";
  const branch = typeof row.branch === "string" ? row.branch.trim() : "";
  const topic = typeof row.topic === "string" ? row.topic.trim() : "";
  if (!id || !title || !summary || !branch || !topic) return null;
  const keyPoints = Array.isArray(row.keyPoints)
    ? row.keyPoints
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  return {
    id,
    exam,
    branch,
    topic,
    title,
    summary,
    keyPoints,
    formula: typeof row.formula === "string" ? row.formula : undefined,
    trap: typeof row.trap === "string" ? row.trap : undefined,
    sourceSolutionId:
      typeof row.sourceSolutionId === "string"
        ? row.sourceSolutionId
        : undefined,
  };
}

export function normalizeTrialAnalysis(
  value: unknown,
): NotalTrialAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const kind = row.kind === "branch" ? "branch" : row.kind === "general" ? "general" : null;
  const exam = row.exam;
  if (!kind || !isYksExam(exam)) return null;

  const id =
    typeof row.id === "string" && row.id.trim()
      ? row.id.trim()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name =
    typeof row.name === "string" && row.name.trim()
      ? row.name.trim()
      : kind === "branch"
        ? `${exam} Branş Denemesi`
        : `${exam} Genel Deneme`;
  const branch =
    typeof row.branch === "string" && row.branch.trim()
      ? row.branch.trim()
      : null;
  const takenAt =
    typeof row.takenAt === "string" && row.takenAt.trim()
      ? row.takenAt.trim()
      : typeof row.taken_at === "string" && row.taken_at.trim()
        ? row.taken_at.trim()
        : null;
  const createdAt =
    typeof row.createdAt === "string" && row.createdAt.trim()
      ? row.createdAt.trim()
      : new Date().toISOString();

  const solutions = Array.isArray(row.solutions)
    ? row.solutions
        .map(normalizeSolution)
        .filter((item): item is NotalTrialAnalysisSolution => Boolean(item))
        .slice(0, MAX_TRIAL_ANALYSIS_IMAGES)
    : [];
  const knowledgeCards = Array.isArray(row.knowledgeCards)
    ? row.knowledgeCards
        .map(normalizeCard)
        .filter((item): item is NotalTrialAnalysisCard => Boolean(item))
        .slice(0, MAX_TRIAL_ANALYSIS_IMAGES)
    : [];

  return {
    id,
    kind,
    exam,
    branch: kind === "branch" ? branch : null,
    name,
    takenAt,
    tytNet: parseNet(row.tytNet ?? row.tyt_net),
    aytNet: parseNet(row.aytNet ?? row.ayt_net),
    ydsNet: parseNet(row.ydsNet ?? row.yds_net),
    branchNet: parseNet(row.branchNet ?? row.branch_net),
    wrongCount: parseCount(row.wrongCount ?? row.wrong_count),
    blankCount: parseCount(row.blankCount ?? row.blank_count),
    attachmentCount: Math.max(
      0,
      Math.round(parseNet(row.attachmentCount ?? row.attachment_count) ?? solutions.length),
    ),
    solutions,
    knowledgeCards,
    createdAt,
  };
}

export function normalizeTrialAnalyses(value: unknown): NotalTrialAnalysis[] {
  if (!Array.isArray(value)) return [];
  const result: NotalTrialAnalysis[] = [];
  for (const item of value) {
    const analysis = normalizeTrialAnalysis(item);
    if (analysis) result.push(analysis);
  }
  return result.slice(0, MAX_TRIAL_ANALYSES);
}

export function formatTrialAnalysisSummary(analysis: NotalTrialAnalysis): string {
  if (analysis.kind === "branch") {
    const net =
      analysis.branchNet !== null
        ? `${analysis.branchNet} net`
        : "Net girilmedi";
    return `${analysis.branch ?? "Branş"} · ${net}`;
  }
  const parts: string[] = [];
  if (analysis.tytNet !== null) parts.push(`TYT ${analysis.tytNet}`);
  if (analysis.aytNet !== null) parts.push(`AYT ${analysis.aytNet}`);
  if (analysis.ydsNet !== null) parts.push(`YDS ${analysis.ydsNet}`);
  if (!parts.length && analysis.exam === "TYT" && analysis.tytNet === null) {
    // single-exam general with net on matching field only
  }
  if (!parts.length) {
    const single =
      analysis.exam === "TYT"
        ? analysis.tytNet
        : analysis.exam === "AYT"
          ? analysis.aytNet
          : analysis.ydsNet;
    if (single !== null) parts.push(`${analysis.exam} ${single}`);
  }
  return parts.join(" · ") || `${analysis.exam} genel deneme`;
}
