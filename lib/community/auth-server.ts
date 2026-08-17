import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type CommunityAuthContext = {
  user: User;
  token: string;
  supabase: SupabaseClient;
};

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function createCommunityUserClient(accessToken: string): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config) return null;

  return createClient(config.url, config.anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function resolveCommunityApiAuth(
  request: Request,
): Promise<CommunityAuthContext | null> {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) return null;

  const supabase = createCommunityUserClient(token);
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  return { user: data.user, token, supabase };
}

export function sameUserId(a: string | null | undefined, b: string | null | undefined) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}
