import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * NotAl istemci — ana site ile aynı localStorage oturumunu okur.
 *
 * Tek örnek (singleton) şart: her çağrıda yeni client kurulursa aynı oturum
 * anahtarı için birden fazla GoTrueClient aynı kilidi bekler ve getSession()
 * süresiz askıda kalabilir.
 */
let cachedClient: SupabaseClient | null | undefined;

export function getNotalAuthBrowserClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  cachedClient =
    url && anonKey
      ? createClient(url, anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        })
      : null;

  return cachedClient;
}

/** @deprecated Paylaşımlı örnek için getNotalAuthBrowserClient kullan. */
export const createNotalAuthBrowserClient = getNotalAuthBrowserClient;

export type NotalSessionRead =
  | { status: "ok"; token: string }
  /** Oturum yok → giriş gerekir. */
  | { status: "none" }
  /** Oturum okunamadı (askıda kaldı/hata) → yeniden denenebilir. */
  | { status: "unavailable" };

const SESSION_TIMEOUT = Symbol("notal-session-timeout");

/** Oturum okuma askıda kalırsa çağıranı sonsuza kilitlemeyelim. */
export async function readNotalSession(
  timeoutMs = 8000,
): Promise<NotalSessionRead> {
  const supabase = getNotalAuthBrowserClient();
  if (!supabase) return { status: "none" };

  try {
    const outcome = await Promise.race([
      supabase.auth.getSession().then(({ data }) => data.session),
      new Promise<typeof SESSION_TIMEOUT>((resolve) =>
        setTimeout(() => resolve(SESSION_TIMEOUT), timeoutMs),
      ),
    ]);

    if (outcome === SESSION_TIMEOUT) return { status: "unavailable" };
    const token = outcome?.access_token;
    return token ? { status: "ok", token } : { status: "none" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getNotalAccessToken(
  timeoutMs = 8000,
): Promise<string | null> {
  const session = await readNotalSession(timeoutMs);
  return session.status === "ok" ? session.token : null;
}

export function notalLoginRedirectUrl(path = "/notal"): string {
  return `/login?redirect=${encodeURIComponent(path)}`;
}
