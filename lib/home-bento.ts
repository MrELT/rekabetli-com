import { createSupabaseAnonServerClient } from "@/lib/supabase-public-server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type HomeBentoTrendingRow = {
  id: string;
  name: string;
  visibility: "public" | "private";
  member_count: number;
  avatar_url: string | null;
};

export type HomeBentoPayload = {
  count: number;
  trending: HomeBentoTrendingRow[];
  fetchedAt: number;
};

function isSafeHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizePlainName(value: unknown, maxLength = 120): string {
  let text = String(value ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length > maxLength) text = text.slice(0, maxLength);
  return text;
}

export function sanitizeHomeBentoTrendingRow(
  row: unknown,
): HomeBentoTrendingRow | null {
  if (!row || typeof row !== "object") return null;

  const record = row as Record<string, unknown>;
  const id = String(record.id ?? "").trim();
  if (!UUID_RE.test(id)) return null;

  const name = sanitizePlainName(record.name);
  if (!name) return null;

  const visibility = record.visibility === "private" ? "private" : "public";
  const memberCount = Math.max(
    0,
    Math.min(1_000_000, Math.round(Number(record.member_count) || 0)),
  );

  const rawAvatar = String(record.avatar_url ?? "").trim();
  const avatar_url =
    rawAvatar && isSafeHttpsUrl(rawAvatar) ? rawAvatar : null;

  return {
    id,
    name,
    visibility,
    member_count: memberCount,
    avatar_url,
  };
}

export function sanitizeHomeBentoPayload(
  value: unknown,
): HomeBentoPayload | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const count = Math.max(
    0,
    Math.min(1_000_000, Math.round(Number(record.count) || 0)),
  );
  const trending = Array.isArray(record.trending)
    ? record.trending
        .map(sanitizeHomeBentoTrendingRow)
        .filter((row): row is HomeBentoTrendingRow => Boolean(row))
        .slice(0, 3)
    : [];

  const fetchedAt = Number(record.fetchedAt);
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;

  return { count, trending, fetchedAt };
}

/** `<script>` içine güvenli JSON (XSS önleme). */
export function serializeForScriptTag(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export async function fetchHomeBentoPayload(): Promise<HomeBentoPayload | null> {
  const sb = createSupabaseAnonServerClient();
  if (!sb) return null;

  const [countResult, statsResult] = await Promise.all([
    sb.from("communities").select("id", { count: "exact", head: true }),
    sb.rpc("get_communities_bento_stats", { p_limit: 3 }),
  ]);

  if (countResult.error) {
    console.error("[home-bento] communities:", countResult.error.message);
    return null;
  }

  const count = countResult.count ?? 0;

  let statsRows: Array<Record<string, unknown>> = [];

  if (!statsResult.error && statsResult.data?.length) {
    statsRows = statsResult.data as Array<Record<string, unknown>>;
  } else if (statsResult.error) {
    console.warn("[home-bento] rpc:", statsResult.error.message);
  }

  const trending = statsRows
    .map((row) =>
      sanitizeHomeBentoTrendingRow({
        ...row,
        avatar_url: String(row.avatar_url ?? "").trim() || null,
      }),
    )
    .filter((row): row is HomeBentoTrendingRow => Boolean(row))
    .slice(0, 3);

  return {
    count,
    trending,
    fetchedAt: Date.now(),
  };
}
