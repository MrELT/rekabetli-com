import {
  exchangeGoogleCode,
  isGoogleCalendarConfigured,
  saveGoogleTokens,
} from "@/lib/notal/google-calendar/oauth";
import { verifyGoogleOAuthState } from "@/lib/notal/google-calendar/oauth-state";

export const runtime = "nodejs";

function appBase(request: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(request: Request) {
  const base = appBase(request);
  const go = (query: Record<string, string>) =>
    Response.redirect(`${base}/notal?${new URLSearchParams(query)}`, 302);

  if (!isGoogleCalendarConfigured()) {
    return go({ google: "not_configured", view: "takvim" });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return go({ google: "denied", view: "takvim" });
  }

  if (!code || !state) {
    return go({ google: "invalid", view: "takvim" });
  }

  const userId = verifyGoogleOAuthState(state);
  if (!userId) {
    return go({ google: "invalid_state", view: "takvim" });
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    await saveGoogleTokens(userId, tokens);
    return go({ google: "connected", view: "takvim" });
  } catch (error) {
    console.error("[google] callback:", error);
    return go({ google: "error", view: "takvim" });
  }
}
