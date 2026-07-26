import { resolveNotalAuth } from "@/lib/notal/auth-server";
import {
  buildGoogleAuthUrl,
  isGoogleCalendarConfigured,
} from "@/lib/notal/google-calendar/oauth";
import { signGoogleOAuthState } from "@/lib/notal/google-calendar/oauth-state";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  if (!isGoogleCalendarConfigured()) {
    return jsonError("google_not_configured", 503);
  }

  const state = signGoogleOAuthState(auth.user.id);
  const url = buildGoogleAuthUrl(state);
  return Response.json({ url });
}
