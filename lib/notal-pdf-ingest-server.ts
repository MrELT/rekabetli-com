import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreditIdentity } from "@/lib/notal-credits-server";

const INGEST_KEY_RE = /^[a-zA-Z0-9_-]{8,64}$/;

interface IngestRow {
  id: string;
  ingest_key: string;
  user_id: string | null;
  visitor_id: string | null;
  total_chunks: number;
  chunks_embedded: number;
  pdf_url: string | null;
  title: string | null;
  completed_at: string | null;
  grant_claimed_at: string | null;
}

function ingestsTable(supabase: SupabaseClient) {
  return supabase.from("notal_pdf_ingests");
}

export function normalizeIngestKey(key: string | null | undefined): string | null {
  const k = key?.trim();
  if (!k || !INGEST_KEY_RE.test(k)) return null;
  return k;
}

async function findIngest(
  supabase: SupabaseClient,
  identity: CreditIdentity,
  ingestKey: string,
): Promise<IngestRow | null> {
  let query = ingestsTable(supabase).select("*").eq("ingest_key", ingestKey);

  if (identity.userId) {
    query = query.eq("user_id", identity.userId);
  } else {
    query = query.eq("visitor_id", identity.visitorId!);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as IngestRow | null) ?? null;
}

export async function recordPdfIngestProgress(
  supabase: SupabaseClient,
  identity: CreditIdentity,
  params: {
    ingestKey: string;
    totalChunks: number;
    batchSize: number;
    pdfUrl?: string | null;
    title?: string | null;
  },
): Promise<{ complete: boolean }> {
  const ingestKey = normalizeIngestKey(params.ingestKey);
  if (!ingestKey) {
    throw new Error("Geçersiz ingest anahtarı.");
  }

  if (params.totalChunks < 1 || params.batchSize < 1) {
    throw new Error("Geçersiz parça sayısı.");
  }

  const now = new Date().toISOString();
  const existing = await findIngest(supabase, identity, ingestKey);

  if (!existing) {
    const chunksEmbedded = Math.min(params.batchSize, params.totalChunks);
    const complete = chunksEmbedded >= params.totalChunks;

    const { error } = await ingestsTable(supabase).insert({
      ingest_key: ingestKey,
      user_id: identity.userId,
      visitor_id: identity.userId ? null : identity.visitorId,
      total_chunks: params.totalChunks,
      chunks_embedded: chunksEmbedded,
      pdf_url: params.pdfUrl?.trim() || null,
      title: params.title?.trim().slice(0, 200) || null,
      completed_at: complete ? now : null,
      updated_at: now,
    });

    if (error) throw error;
    return { complete };
  }

  if (existing.grant_claimed_at) {
    throw new Error("Bu yükleme için hak zaten tanımlandı.");
  }

  if (existing.total_chunks !== params.totalChunks) {
    throw new Error("Parça sayısı oturumla uyuşmuyor.");
  }

  const nextEmbedded = Math.min(
    existing.total_chunks,
    existing.chunks_embedded + params.batchSize,
  );
  const complete = nextEmbedded >= existing.total_chunks;

  const { error } = await ingestsTable(supabase)
    .update({
      chunks_embedded: nextEmbedded,
      pdf_url: params.pdfUrl?.trim() || existing.pdf_url || null,
      title: params.title?.trim().slice(0, 200) || existing.title || null,
      completed_at: complete ? now : existing.completed_at,
      updated_at: now,
    })
    .eq("id", existing.id);

  if (error) throw error;
  return { complete };
}

export async function claimCompletedPdfIngest(
  supabase: SupabaseClient,
  identity: CreditIdentity,
  ingestKeyRaw: string,
): Promise<boolean> {
  const ingestKey = normalizeIngestKey(ingestKeyRaw);
  if (!ingestKey) return false;

  const row = await findIngest(supabase, identity, ingestKey);
  if (!row) return false;
  if (row.grant_claimed_at) return false;
  if (row.chunks_embedded < row.total_chunks || !row.completed_at) {
    return false;
  }

  const now = new Date().toISOString();
  const { data, error } = await ingestsTable(supabase)
    .update({ grant_claimed_at: now, updated_at: now })
    .eq("id", row.id)
    .is("grant_claimed_at", null)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}
