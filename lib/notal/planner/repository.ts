import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  NotalPlanBlock,
  NotalPlanBlockInput,
  NotalPlanSource,
} from "@/lib/notal/planner/types";

export async function listPlanBlocksInRange(
  supabase: SupabaseClient,
  userId: string,
  rangeStartIso: string,
  rangeEndIso: string,
): Promise<NotalPlanBlock[]> {
  const { data, error } = await supabase
    .from("notal_plan_blocks")
    .select(
      "id, user_id, start_at, end_at, title, notes, source, google_event_id, created_at, updated_at",
    )
    .eq("user_id", userId)
    .lt("start_at", rangeEndIso)
    .gt("end_at", rangeStartIso)
    .order("start_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as NotalPlanBlock[];
}

export async function createPlanBlock(
  supabase: SupabaseClient,
  userId: string,
  input: NotalPlanBlockInput,
): Promise<NotalPlanBlock> {
  const { data, error } = await supabase
    .from("notal_plan_blocks")
    .insert({
      user_id: userId,
      start_at: input.start_at,
      end_at: input.end_at,
      title: input.title.trim(),
      notes: (input.notes || "").trim(),
      source: input.source || "planner",
      google_event_id: input.google_event_id ?? null,
    })
    .select(
      "id, user_id, start_at, end_at, title, notes, source, google_event_id, created_at, updated_at",
    )
    .single();

  if (error) throw error;
  return data as NotalPlanBlock;
}

export async function createPlanBlocks(
  supabase: SupabaseClient,
  userId: string,
  inputs: NotalPlanBlockInput[],
): Promise<NotalPlanBlock[]> {
  if (!inputs.length) return [];

  const rows = inputs.map((input) => ({
    user_id: userId,
    start_at: input.start_at,
    end_at: input.end_at,
    title: input.title.trim(),
    notes: (input.notes || "").trim(),
    source: (input.source || "planner") as NotalPlanSource,
    google_event_id: input.google_event_id ?? null,
  }));

  const { data, error } = await supabase
    .from("notal_plan_blocks")
    .insert(rows)
    .select(
      "id, user_id, start_at, end_at, title, notes, source, google_event_id, created_at, updated_at",
    )
    .order("start_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as NotalPlanBlock[];
}

export async function updatePlanBlock(
  supabase: SupabaseClient,
  userId: string,
  blockId: string,
  patch: Partial<NotalPlanBlockInput> & { google_event_id?: string | null },
): Promise<NotalPlanBlock | null> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.start_at !== undefined) payload.start_at = patch.start_at;
  if (patch.end_at !== undefined) payload.end_at = patch.end_at;
  if (patch.title !== undefined) payload.title = patch.title.trim();
  if (patch.notes !== undefined) payload.notes = patch.notes.trim();
  if (patch.source !== undefined) payload.source = patch.source;
  if (patch.google_event_id !== undefined) {
    payload.google_event_id = patch.google_event_id;
  }

  const { data, error } = await supabase
    .from("notal_plan_blocks")
    .update(payload)
    .eq("id", blockId)
    .eq("user_id", userId)
    .select(
      "id, user_id, start_at, end_at, title, notes, source, google_event_id, created_at, updated_at",
    )
    .maybeSingle();

  if (error) throw error;
  return (data as NotalPlanBlock | null) ?? null;
}

export async function deletePlanBlock(
  supabase: SupabaseClient,
  userId: string,
  blockId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("notal_plan_blocks")
    .delete()
    .eq("id", blockId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function getPlanBlock(
  supabase: SupabaseClient,
  userId: string,
  blockId: string,
): Promise<NotalPlanBlock | null> {
  const { data, error } = await supabase
    .from("notal_plan_blocks")
    .select(
      "id, user_id, start_at, end_at, title, notes, source, google_event_id, created_at, updated_at",
    )
    .eq("id", blockId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as NotalPlanBlock | null) ?? null;
}
