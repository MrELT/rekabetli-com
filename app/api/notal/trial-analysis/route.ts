import { resolveNotalAuth } from "@/lib/notal/auth-server";
import {
  parseChatAttachments,
  type NotalChatAttachmentInput,
} from "@/lib/notal/chat-attachments";
import { fetchStudentProfile } from "@/lib/notal/student-context-server";
import { readStudentProfileFromUserMeta } from "@/lib/notal/student-context";
import { createTrialAnalysis } from "@/lib/notal/trial-analysis-server";
import {
  MAX_TRIAL_ANALYSIS_IMAGES,
  type TrialAnalysisKind,
} from "@/lib/notal/trial-analysis";

export const runtime = "nodejs";
export const maxDuration = 120;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

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

export async function GET(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  const profile =
    (await fetchStudentProfile(auth.user.id)) ??
    readStudentProfileFromUserMeta(
      (auth.user.user_metadata ?? {}) as Record<string, unknown>,
    );

  return Response.json({
    analyses: profile.trialAnalyses,
    latest: profile.trialAnalyses[0] ?? null,
  });
}

export async function POST(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_json", 400);
  }

  const bodyObj =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const kindRaw = bodyObj.kind;
  const kind: TrialAnalysisKind | null =
    kindRaw === "general" || kindRaw === "branch" ? kindRaw : null;
  const examRaw = bodyObj.exam;
  const exam =
    examRaw === "TYT" || examRaw === "AYT" || examRaw === "YDS" ? examRaw : null;

  if (!kind || !exam) {
    return jsonError("invalid_payload", 400);
  }

  const branch =
    typeof bodyObj.branch === "string" ? bodyObj.branch.trim() : "";
  if (kind === "branch" && !branch) {
    return jsonError("branch_required", 400);
  }

  const parsedAttachments = parseChatAttachments(bodyObj.attachments).filter(
    (item): item is NotalChatAttachmentInput => item.kind === "image",
  );
  if (parsedAttachments.length > MAX_TRIAL_ANALYSIS_IMAGES) {
    return jsonError("too_many_attachments", 400);
  }

  const rawAttachments = Array.isArray(bodyObj.attachments)
    ? bodyObj.attachments
    : [];
  const attachments = parsedAttachments.map((item, index) => {
    const raw =
      rawAttachments[index] && typeof rawAttachments[index] === "object"
        ? (rawAttachments[index] as Record<string, unknown>)
        : {};
    const mistakeKind: "wrong" | "blank" | null =
      raw.mistakeKind === "wrong" || raw.mistakeKind === "blank"
        ? raw.mistakeKind
        : null;
    return { ...item, mistakeKind };
  });

  const result = await createTrialAnalysis({
    userId: auth.user.id,
    signal: request.signal,
    input: {
      kind,
      exam,
      branch: branch || null,
      name: typeof bodyObj.name === "string" ? bodyObj.name : null,
      takenAt: typeof bodyObj.takenAt === "string" ? bodyObj.takenAt : null,
      tytNet: parseNet(bodyObj.tytNet),
      aytNet: parseNet(bodyObj.aytNet),
      ydsNet: parseNet(bodyObj.ydsNet),
      branchNet: parseNet(bodyObj.branchNet),
      wrongCount: parseCount(bodyObj.wrongCount),
      blankCount: parseCount(bodyObj.blankCount),
      branchStats: Array.isArray(bodyObj.branchStats)
        ? bodyObj.branchStats.map((item) => {
            const row =
              item && typeof item === "object"
                ? (item as Record<string, unknown>)
                : {};
            return {
              branch: typeof row.branch === "string" ? row.branch : "",
              net: parseNet(row.net),
              wrongCount: parseCount(row.wrongCount),
              blankCount: parseCount(row.blankCount),
            };
          })
        : [],
      attachments,
    },
  });

  if (!result.ok) {
    const status =
      result.error === "service_role_not_configured"
        ? 503
        : result.error === "branch_required" ||
            result.error === "invalid_stats" ||
            result.error === "aborted" ||
            /net|boş|yanlış|soru|tutarsız|mümkün değil|Branş|fotoğraf/i.test(
              result.error,
            )
          ? 400
          : 500;
    return jsonError(result.error, status);
  }

  return Response.json({
    analysis: result.analysis,
    solutions: result.analysis.solutions,
    knowledgeCards: result.analysis.knowledgeCards,
    context: result.profile,
  });
}
