import { resolveNotalAuth } from "@/lib/notal/auth-server";
import { importGoogleEventsInRange } from "@/lib/notal/google-calendar/sync";

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

/** Görünen aralıktaki Google etkinliklerini NotAl takvimine çeker. */
export async function POST(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    /* empty ok if query used */
  }

  const url = new URL(request.url);
  const from =
    parseIso(body.from) || parseIso(url.searchParams.get("from"));
  const to = parseIso(body.to) || parseIso(url.searchParams.get("to"));
  if (!from || !to) return jsonError("invalid_range", 400);

  try {
    const result = await importGoogleEventsInRange({
      supabase: auth.supabase,
      userId: auth.user.id,
      rangeStartIso: from,
      rangeEndIso: to,
    });

    if (result.error === "google_not_connected") {
      return jsonError("google_not_connected", 400);
    }
    if (result.error) {
      return Response.json(
        { error: "google_import_failed", detail: result.error, ...result },
        { status: 502 },
      );
    }

    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[google] sync route:", error);
    return jsonError("sync_failed", 500);
  }
}
