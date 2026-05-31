import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreditIdentity } from "@/lib/notal-credits-server";
import type { NotalNoteFeedbackSummary } from "@/lib/notal-feedback-shared";

const MAX_COMMENT_LENGTH = 1200;

interface FeedbackRow {
  id: string;
  note_id: string;
  user_id: string | null;
  visitor_id: string | null;
  score: number | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminNotalNoteFeedback {
  id: string;
  score: number | null;
  comment: string | null;
  created_at: string;
  user_id: string | null;
  visitor_id: string | null;
}

export interface AdminNotalNoteWithFeedback {
  id: string;
  title: string;
  subject: string;
  depth: string;
  created_at: string;
  ratingAvg: number | null;
  ratingCount: number;
  feedback: AdminNotalNoteFeedback[];
}

function feedbackTable(supabase: SupabaseClient) {
  return supabase.from("notal_note_feedback");
}

function computeStats(rows: Pick<FeedbackRow, "score">[]) {
  const scored = rows.filter((r) => typeof r.score === "number");
  const ratingCount = scored.length;
  if (ratingCount === 0) {
    return { ratingAvg: null, ratingCount: 0 };
  }
  const sum = scored.reduce((acc, r) => acc + (r.score ?? 0), 0);
  return { ratingAvg: sum / ratingCount, ratingCount };
}

function findMine(
  rows: FeedbackRow[],
  identity: CreditIdentity,
): FeedbackRow | null {
  return (
    rows.find((row) =>
      identity.userId
        ? row.user_id === identity.userId
        : row.visitor_id === identity.visitorId,
    ) ?? null
  );
}

export async function getNoteFeedbackSummary(
  supabase: SupabaseClient,
  noteId: string,
  identity: CreditIdentity,
): Promise<NotalNoteFeedbackSummary> {
  const { data, error } = await feedbackTable(supabase)
    .select("id, note_id, user_id, visitor_id, score, comment, created_at, updated_at")
    .eq("note_id", noteId);

  if (error) throw error;

  const rows = (data ?? []) as FeedbackRow[];
  const { ratingAvg, ratingCount } = computeStats(rows);
  const mine = findMine(rows, identity);

  return {
    ratingAvg,
    ratingCount,
    myScore: mine?.score ?? null,
    myComment: mine?.comment?.trim() || null,
  };
}

export async function upsertNoteFeedback(
  supabase: SupabaseClient,
  noteId: string,
  identity: CreditIdentity,
  params: { score?: number | null; comment?: string | null },
): Promise<NotalNoteFeedbackSummary> {
  const trimmedComment =
    typeof params.comment === "string" ? params.comment.trim() : undefined;

  let score: number | null | undefined = params.score;
  if (score != null) {
    score = Math.min(5, Math.max(1, Math.round(score)));
  }

  if (score == null && (!trimmedComment || trimmedComment.length === 0)) {
    throw new Error("Puan veya geri bildirim metni gerekli.");
  }

  if (trimmedComment && trimmedComment.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Geri bildirim en fazla ${MAX_COMMENT_LENGTH} karakter olabilir.`);
  }

  const { data: fullRows, error: fullError } = await feedbackTable(supabase)
    .select("id, note_id, user_id, visitor_id, score, comment, created_at, updated_at")
    .eq("note_id", noteId);

  if (fullError) throw fullError;

  const rows = (fullRows ?? []) as FeedbackRow[];
  const existing = findMine(rows, identity);

  const nextScore =
    score !== undefined ? score : (existing?.score ?? null);
  const nextComment =
    trimmedComment !== undefined
      ? trimmedComment || null
      : (existing?.comment ?? null);

  if (nextScore == null && (!nextComment || nextComment.length === 0)) {
    throw new Error("Puan veya geri bildirim metni gerekli.");
  }

  const payload = {
    note_id: noteId,
    user_id: identity.userId,
    visitor_id: identity.userId ? null : identity.visitorId,
    score: nextScore,
    comment: nextComment,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await feedbackTable(supabase)
      .update(payload)
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await feedbackTable(supabase).insert(payload);
    if (error) throw error;
  }

  return getNoteFeedbackSummary(supabase, noteId, identity);
}

export type { NotalNoteFeedbackSummary } from "@/lib/notal-feedback-shared";
