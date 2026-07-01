import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Herkese açık okumalar için yalnızca anon key (en az yetki). */
export function createSupabaseAnonServerClient(): SupabaseClient | null {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey =
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
