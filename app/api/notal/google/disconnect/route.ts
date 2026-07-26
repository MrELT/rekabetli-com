import { resolveNotalAuth } from "@/lib/notal/auth-server";
import { deleteGoogleTokens } from "@/lib/notal/google-calendar/oauth";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  try {
    await deleteGoogleTokens(auth.user.id);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[google] disconnect:", error);
    return jsonError("disconnect_failed", 500);
  }
}
