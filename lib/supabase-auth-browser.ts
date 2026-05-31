import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let authClient: SupabaseClient | null = null;

export function createSupabaseAuthBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) return null;

  if (!authClient) {
    authClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return authClient;
}

export async function getNotalAuthSession(): Promise<Session | null> {
  const supabase = createSupabaseAuthBrowserClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("notal auth session:", error.message);
    return null;
  }

  return data.session ?? null;
}
