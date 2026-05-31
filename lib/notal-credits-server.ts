import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildCreditsState,
  NOTAL_MAX_PDF_GRANTS,
  NOTAL_NOTES_PER_GRANT,
  type NotalCreditsState,
} from "@/lib/notal-credits-shared";

export interface CreditIdentity {
  userId: string | null;
  visitorId: string | null;
}

interface CreditRow {
  id: string;
  user_id: string | null;
  visitor_id: string | null;
  notes_remaining: number;
  pdf_grant_count: number;
}

export function normalizeVisitorId(id: string | null | undefined): string | null {
  const v = id?.trim();
  if (!v || v.length > 64) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(v)) return null;
  return v;
}

export function parseCreditIdentity(
  userId: string | null | undefined,
  visitorId: string | null | undefined,
): CreditIdentity | null {
  const uid = userId?.trim() || null;
  const vid = normalizeVisitorId(visitorId);
  if (!uid && !vid) return null;
  return { userId: uid, visitorId: vid };
}

async function findRow(
  supabase: SupabaseClient,
  identity: CreditIdentity,
): Promise<CreditRow | null> {
  if (identity.userId) {
    const { data } = await supabase
      .from("notal_user_credits")
      .select("*")
      .eq("user_id", identity.userId)
      .maybeSingle();
    if (data) return data as CreditRow;
  }

  if (identity.visitorId) {
    const { data } = await supabase
      .from("notal_user_credits")
      .select("*")
      .eq("visitor_id", identity.visitorId)
      .maybeSingle();
    if (data) return data as CreditRow;
  }

  return null;
}

async function createRow(
  supabase: SupabaseClient,
  identity: CreditIdentity,
): Promise<CreditRow> {
  const { data, error } = await supabase
    .from("notal_user_credits")
    .insert({
      user_id: identity.userId,
      visitor_id: identity.userId ? null : identity.visitorId,
      notes_remaining: 0,
      pdf_grant_count: 0,
    })
    .select("*")
    .single();

  if (error) {
    const existing = await findRow(supabase, identity);
    if (existing) return existing;
    throw error;
  }

  return data as CreditRow;
}

export async function getOrCreateCredits(
  supabase: SupabaseClient,
  identity: CreditIdentity,
): Promise<NotalCreditsState> {
  let row = await findRow(supabase, identity);
  if (!row) {
    row = await createRow(supabase, identity);
  }
  return buildCreditsState(row);
}

export async function consumeNotalCredit(
  supabase: SupabaseClient,
  identity: CreditIdentity,
): Promise<{ ok: true; credits: NotalCreditsState } | { ok: false; credits: NotalCreditsState }> {
  const row = await findRow(supabase, identity);
  if (!row || row.notes_remaining < 1) {
    const credits = row
      ? buildCreditsState(row)
      : buildCreditsState({ notes_remaining: 0, pdf_grant_count: 0 });
    return { ok: false, credits };
  }

  const { data, error } = await supabase
    .from("notal_user_credits")
    .update({
      notes_remaining: row.notes_remaining - 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .gte("notes_remaining", 1)
    .select("*")
    .maybeSingle();

  if (error || !data) {
    const credits = await getOrCreateCredits(supabase, identity);
    return { ok: false, credits };
  }

  return { ok: true, credits: buildCreditsState(data as CreditRow) };
}

export async function refundNotalCredit(
  supabase: SupabaseClient,
  identity: CreditIdentity,
): Promise<void> {
  const row = await findRow(supabase, identity);
  if (!row) return;

  await supabase
    .from("notal_user_credits")
    .update({
      notes_remaining: Math.min(
        NOTAL_NOTES_PER_GRANT,
        row.notes_remaining + 1,
      ),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
}

export type GrantPdfResult =
  | { granted: true; credits: NotalCreditsState }
  | { granted: false; reason: "limit_reached"; credits: NotalCreditsState };

export async function grantCreditsFromPdfDonation(
  supabase: SupabaseClient,
  identity: CreditIdentity,
): Promise<GrantPdfResult> {
  let row = await findRow(supabase, identity);
  if (!row) {
    row = await createRow(supabase, identity);
  }

  if (row.pdf_grant_count >= NOTAL_MAX_PDF_GRANTS) {
    return {
      granted: false,
      reason: "limit_reached",
      credits: buildCreditsState(row),
    };
  }

  const { data, error } = await supabase
    .from("notal_user_credits")
    .update({
      notes_remaining: NOTAL_NOTES_PER_GRANT,
      pdf_grant_count: row.pdf_grant_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .lt("pdf_grant_count", NOTAL_MAX_PDF_GRANTS)
    .select("*")
    .single();

  if (error || !data) {
    const fresh = await findRow(supabase, identity);
    if (fresh && fresh.pdf_grant_count >= NOTAL_MAX_PDF_GRANTS) {
      return {
        granted: false,
        reason: "limit_reached",
        credits: buildCreditsState(fresh),
      };
    }
    throw error ?? new Error("Hak güncellenemedi.");
  }

  return { granted: true, credits: buildCreditsState(data as CreditRow) };
}

/** Giriş yapmış kullanıcı: ziyaretçi kaydını hesaba bağla */
export async function linkVisitorToUser(
  supabase: SupabaseClient,
  userId: string,
  visitorId: string,
): Promise<void> {
  const vid = normalizeVisitorId(visitorId);
  if (!vid) return;

  const visitorRow = await findRow(supabase, { userId: null, visitorId: vid });
  const userRow = await findRow(supabase, { userId, visitorId: null });

  if (!visitorRow) return;

  if (!userRow) {
    await supabase
      .from("notal_user_credits")
      .update({ user_id: userId, visitor_id: null })
      .eq("id", visitorRow.id);
    return;
  }

  const mergedNotes = Math.min(
    NOTAL_NOTES_PER_GRANT,
    Math.max(userRow.notes_remaining, visitorRow.notes_remaining),
  );
  const mergedGrants = Math.min(
    NOTAL_MAX_PDF_GRANTS,
    Math.max(userRow.pdf_grant_count, visitorRow.pdf_grant_count),
  );

  await supabase
    .from("notal_user_credits")
    .update({
      notes_remaining: mergedNotes,
      pdf_grant_count: mergedGrants,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userRow.id);

  await supabase.from("notal_user_credits").delete().eq("id", visitorRow.id);
}
