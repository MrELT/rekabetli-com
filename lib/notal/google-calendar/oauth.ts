import { google } from "googleapis";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
];

export type StoredGoogleTokens = {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expiry_date: string | null;
  scope: string;
};

export function isGoogleCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
}

export function getGoogleRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    "http://localhost:3000/api/notal/google/callback"
  );
}

export function createGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("google_not_configured");
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    getGoogleRedirectUri(),
  );
}

export function buildGoogleAuthUrl(state: string): string {
  const client = createGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_CALENDAR_SCOPES,
    state,
  });
}

export async function exchangeGoogleCode(code: string) {
  const client = createGoogleOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function saveGoogleTokens(
  userId: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
    scope?: string | null;
  },
): Promise<void> {
  const supabase = createSupabaseServerClient();
  if (!supabase) throw new Error("supabase_not_configured");
  if (!tokens.access_token) throw new Error("missing_access_token");

  const existing = await getGoogleTokens(userId);
  const refresh = tokens.refresh_token || existing?.refresh_token || null;

  const { error } = await supabase.from("notal_google_tokens").upsert(
    {
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: refresh,
      expiry_date: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      scope: tokens.scope || GOOGLE_CALENDAR_SCOPES.join(" "),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) throw error;
}

export async function getGoogleTokens(
  userId: string,
): Promise<StoredGoogleTokens | null> {
  const supabase = createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("notal_google_tokens")
    .select("user_id, access_token, refresh_token, expiry_date, scope")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as StoredGoogleTokens | null) ?? null;
}

export async function isUserGoogleCalendarConnected(
  userId: string,
): Promise<boolean> {
  if (!isGoogleCalendarConfigured()) return false;
  const tokens = await getGoogleTokens(userId);
  return Boolean(tokens?.access_token);
}

export async function deleteGoogleTokens(userId: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  if (!supabase) throw new Error("supabase_not_configured");

  const { error } = await supabase
    .from("notal_google_tokens")
    .delete()
    .eq("user_id", userId);

  if (error) throw error;
}

export async function getAuthorizedGoogleClient(userId: string) {
  const stored = await getGoogleTokens(userId);
  if (!stored?.access_token) return null;

  const client = createGoogleOAuthClient();
  client.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token || undefined,
    expiry_date: stored.expiry_date
      ? new Date(stored.expiry_date).getTime()
      : undefined,
  });

  client.on("tokens", (tokens) => {
    void saveGoogleTokens(userId, tokens).catch((error) => {
      console.error("[google] token refresh save failed:", error);
    });
  });

  return client;
}
