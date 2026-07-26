import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** NotAl istemci — ana site ile aynı localStorage oturumunu okur. */
export function createNotalAuthBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export function notalLoginRedirectUrl(path = "/notal"): string {
  return `/login?redirect=${encodeURIComponent(path)}`;
}
