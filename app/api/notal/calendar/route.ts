import { resolveNotalAuth } from "@/lib/notal/auth-server";
import {
  createPlanBlock,
  deletePlanBlock,
  getPlanBlock,
  listPlanBlocksInRange,
  updatePlanBlock,
} from "@/lib/notal/planner/repository";
import {
  applyGoogleSyncForBlock,
  deleteLinkedGoogleEvent,
} from "@/lib/notal/google-calendar/sync";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function parseIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export async function GET(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  const url = new URL(request.url);
  const from = parseIso(url.searchParams.get("from"));
  const to = parseIso(url.searchParams.get("to"));
  if (!from || !to) return jsonError("invalid_range", 400);

  try {
    const blocks = await listPlanBlocksInRange(
      auth.supabase,
      auth.user.id,
      from,
      to,
    );
    return Response.json({ blocks });
  } catch (error) {
    console.error("[notal] calendar list:", error);
    return jsonError("list_failed", 500);
  }
}

export async function POST(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("invalid_json", 400);
  }

  const start_at = parseIso(body.start_at);
  const end_at = parseIso(body.end_at);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!start_at || !end_at || !title) return jsonError("invalid_block", 400);
  if (new Date(end_at) <= new Date(start_at)) {
    return jsonError("invalid_range", 400);
  }

  try {
    let block = await createPlanBlock(auth.supabase, auth.user.id, {
      start_at,
      end_at,
      title,
      notes,
      source: "manual",
    });

    const synced = await applyGoogleSyncForBlock(
      auth.supabase,
      auth.user.id,
      block,
    );
    block = synced.block;

    return Response.json({ block }, { status: 201 });
  } catch (error) {
    console.error("[notal] calendar create:", error);
    return jsonError("create_failed", 500);
  }
}

export async function PATCH(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("invalid_json", 400);
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return jsonError("invalid_id", 400);

  const patch: {
    start_at?: string;
    end_at?: string;
    title?: string;
    notes?: string;
  } = {};

  const start_at = parseIso(body.start_at);
  const end_at = parseIso(body.end_at);
  if (start_at) patch.start_at = start_at;
  if (end_at) patch.end_at = end_at;
  if (typeof body.title === "string") patch.title = body.title.trim();
  if (typeof body.notes === "string") patch.notes = body.notes.trim();

  try {
    let block = await updatePlanBlock(
      auth.supabase,
      auth.user.id,
      id,
      patch,
    );
    if (!block) return jsonError("not_found", 404);

    const synced = await applyGoogleSyncForBlock(
      auth.supabase,
      auth.user.id,
      block,
    );
    block = synced.block;

    return Response.json({ block });
  } catch (error) {
    console.error("[notal] calendar update:", error);
    return jsonError("update_failed", 500);
  }
}

export async function DELETE(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim() || "";
  if (!id) return jsonError("invalid_id", 400);

  try {
    const existing = await getPlanBlock(auth.supabase, auth.user.id, id);
    if (!existing) return jsonError("not_found", 404);

    await deleteLinkedGoogleEvent(auth.user.id, existing.google_event_id);

    const deleted = await deletePlanBlock(auth.supabase, auth.user.id, id);
    if (!deleted) return jsonError("not_found", 404);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[notal] calendar delete:", error);
    return jsonError("delete_failed", 500);
  }
}
