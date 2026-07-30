import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import {
  getNotalAccessMode,
  isNotalAdminEmail,
} from "@/lib/notal/access";

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

async function isAdminUser(
  supabase: SupabaseClient,
  user: User,
): Promise<boolean> {
  if (isNotalAdminEmail(user.email)) return true;

  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("[notal] admin_users check:", error.message);
    return false;
  }

  return Boolean(data?.user_id);
}

/**
 * Oturum + NotAl erişim modu.
 * - unauthorized: giriş yok
 * - forbidden: giriş var ama admin değil / NotAl kapalı
 */
export async function resolveNotalApiAuth(
  request: Request,
): Promise<
  | { status: "ok"; auth: NotalAuthContext }
  | { status: "unauthorized" }
  | { status: "forbidden" }
> {
  const mode = getNotalAccessMode();
  if (mode === "off") return { status: "forbidden" };

  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) return { status: "unauthorized" };

  const supabase = createNotalUserClient(token);
  if (!supabase) return { status: "unauthorized" };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { status: "unauthorized" };

  if (mode === "admin") {
    const admin = await isAdminUser(supabase, data.user);
    if (!admin) return { status: "forbidden" };
  }

  return {
    status: "ok",
    auth: { user: data.user, token, supabase },
  };
}

export function notalApiAuthErrorResponse(
  result: Exclude<Awaited<ReturnType<typeof resolveNotalApiAuth>>, { status: "ok" }>,
): Response {
  if (result.status === "unauthorized") {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }
  // Varlığını gizle
  return Response.json({ error: "not_found" }, { status: 404 });
}

export async function resolveNotalAuth(
  request: Request,
): Promise<NotalAuthContext | null> {
  const result = await resolveNotalApiAuth(request);
  if (result.status !== "ok") return null;
  return result.auth;
}

/** API route'larda: auth veya hazır Response döner. */
export async function requireNotalAuth(
  request: Request,
): Promise<NotalAuthContext | Response> {
  const result = await resolveNotalApiAuth(request);
  if (result.status === "ok") return result.auth;
  return notalApiAuthErrorResponse(result);
}

/** @deprecated Prefer resolveNotalAuth */
export async function resolveNotalUserFromRequest(request: Request) {
  const auth = await resolveNotalAuth(request);
  return auth?.user ?? null;
}
