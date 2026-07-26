import { resolveNotalAuth } from "@/lib/notal/auth-server";
import {
  getGoogleTokens,
  isGoogleCalendarConfigured,
} from "@/lib/notal/google-calendar/oauth";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  const configured = isGoogleCalendarConfigured();
  if (!configured) {
    return Response.json({ configured: false, connected: false });
  }

  try {
    const tokens = await getGoogleTokens(auth.user.id);
    return Response.json({
      configured: true,
      connected: Boolean(tokens?.access_token),
    });
  } catch (error) {
    console.error("[google] status:", error);
    return jsonError("status_failed", 500);
  }
}
