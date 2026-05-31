import { NextRequest, NextResponse } from "next/server";
import {
  getNoteFeedbackSummary,
  upsertNoteFeedback,
} from "@/lib/notal-feedback-server";
import { getNotalNoteById } from "@/lib/notal-notes-server";
import { enforceRateLimit } from "@/lib/notal-rate-limit";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import {
  identityRateLimitKey,
  resolveAuthenticatedIdentity,
} from "@/lib/notal-request-identity";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase yapılandırması eksik." },
      { status: 500 },
    );
  }

  const identity = await resolveAuthenticatedIdentity(request);
  if (!identity) {
    return notalAuthRequiredResponse();
  }

  const note = await getNotalNoteById(supabase, identity, id);
  if (!note) {
    return NextResponse.json({ error: "Not bulunamadı." }, { status: 404 });
  }

  try {
    const feedback = await getNoteFeedbackSummary(supabase, id, identity);
    return NextResponse.json({ feedback });
  } catch (error) {
    console.error("notal feedback get:", error);
    return NextResponse.json(
      { error: "Geri bildirim yüklenemedi." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase yapılandırması eksik." },
      { status: 500 },
    );
  }

  const identity = await resolveAuthenticatedIdentity(request);
  if (!identity) {
    return notalAuthRequiredResponse();
  }

  const note = await getNotalNoteById(supabase, identity, id);
  if (!note) {
    return NextResponse.json({ error: "Not bulunamadı." }, { status: 404 });
  }

  const limited = enforceRateLimit(
    request,
    "notal-feedback",
    `${identityRateLimitKey(identity)}:${id}`,
    30,
    60 * 60 * 1000,
  );
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  const rawScore =
    typeof body === "object" &&
    body !== null &&
    "score" in body &&
    (body as { score: unknown }).score != null
      ? (body as { score: unknown }).score
      : undefined;

  const score =
    typeof rawScore === "number"
      ? rawScore
      : typeof rawScore === "string" && rawScore.trim()
        ? Number(rawScore)
        : undefined;

  const comment =
    typeof body === "object" &&
    body !== null &&
    "comment" in body &&
    typeof (body as { comment: unknown }).comment === "string"
      ? (body as { comment: string }).comment
      : undefined;

  try {
    const feedback = await upsertNoteFeedback(supabase, id, identity, {
      score: score !== undefined && !Number.isNaN(score) ? score : undefined,
      comment,
    });
    return NextResponse.json({ feedback });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Geri bildirim kaydedilemedi.";
    console.error("notal feedback post:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
