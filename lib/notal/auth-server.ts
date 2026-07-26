import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type NotalAuthContext = {
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

export function createNotalUserClient(accessToken: string): SupabaseClient | null {
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

export async function resolveNotalAuth(
  request: Request,
): Promise<NotalAuthContext | null> {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) return null;

  const supabase = createNotalUserClient(token);
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  return { user: data.user, token, supabase };
}

/** @deprecated Prefer resolveNotalAuth */
export async function resolveNotalUserFromRequest(request: Request) {
  const auth = await resolveNotalAuth(request);
  return auth?.user ?? null;
}
