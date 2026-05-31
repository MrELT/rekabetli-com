import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";

let authClient: SupabaseClient | null = null;
let authClientKey = "";

type LegacySupabase = SupabaseClient & { _rekabetliStub?: boolean };

declare global {
  interface Window {
    getSupabase?: () => LegacySupabase | null;
    __ENV__?: Record<string, string>;
  }
}

function readEnvConfig(): { url: string; anonKey: string } {
  const fromNext = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "",
  };

  if (typeof window === "undefined") {
    return fromNext;
  }

  const runtime = window.__ENV__ ?? {};
  return {
    url: fromNext.url || runtime.SUPABASE_URL?.trim() || "",
    anonKey: fromNext.anonKey || runtime.SUPABASE_ANON_KEY?.trim() || "",
  };
}

function isStubClient(client: SupabaseClient | null): boolean {
  return Boolean((client as LegacySupabase | null)?._rekabetliStub);
}

function getLegacyClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  const legacy = window.getSupabase?.();
  if (legacy && !legacy._rekabetliStub) {
    return legacy;
  }
  return null;
}

/** Statik site ile aynı oturumu kullan (localStorage / getSupabase) */
export function createSupabaseAuthBrowserClient(): SupabaseClient | null {
  const legacy = getLegacyClient();
  if (legacy) {
    authClient = null;
    return legacy;
  }

  const { url, anonKey } = readEnvConfig();
  if (!url || !anonKey) return null;

  const cacheKey = `${url}|${anonKey.slice(0, 12)}`;
  if (!authClient || authClientKey !== cacheKey) {
    authClientKey = cacheKey;
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

async function waitForSupabaseClient(maxMs = 8000): Promise<SupabaseClient | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const { url, anonKey } = readEnvConfig();
    const client = createSupabaseAuthBrowserClient();
    if (url && anonKey && client && !isStubClient(client)) {
      return client;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const client = createSupabaseAuthBrowserClient();
  return client && !isStubClient(client) ? client : null;
}

async function readSessionFromClient(
  supabase: SupabaseClient,
): Promise<Session | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  return session?.access_token ? session : null;
}

/** Oturumu Auth sunucusunda doğrular; gerekirse yeniler (iOS stale session). */
export async function getNotalAuthSession(): Promise<Session | null> {
  const supabase = await waitForSupabaseClient();
  if (!supabase) return null;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userData.user) {
    const session = await readSessionFromClient(supabase);
    if (session) return session;
  }

  const { data: refreshData, error: refreshError } =
    await supabase.auth.refreshSession();
  if (refreshData.session?.access_token) {
    return refreshData.session;
  }

  if (userError) {
    console.warn("notal auth user:", userError.message);
  }
  if (refreshError) {
    console.warn("notal auth refresh:", refreshError.message);
  }

  return readSessionFromClient(supabase);
}

export async function waitForNotalAuthSession(
  timeoutMs = 8000,
): Promise<Session | null> {
  const existing = await getNotalAuthSession();
  if (existing?.access_token) return existing;

  const supabase = await waitForSupabaseClient();
  if (!supabase) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (session: Session | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.unsubscribe();
      resolve(session);
    };

    const timer = setTimeout(() => {
      void getNotalAuthSession().then(finish);
    }, timeoutMs);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        void getNotalAuthSession().then(finish);
      }
    });
  });
}

export async function refreshNotalAuthSession(): Promise<Session | null> {
  const supabase = await waitForSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    console.warn("notal auth manual refresh:", error.message);
  }
  if (data.session?.access_token) {
    return data.session;
  }

  return getNotalAuthSession();
}
