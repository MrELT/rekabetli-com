import { buildLoginRedirectUrl } from "@/lib/notal-auth-client";
import { getNotalAuthSession } from "@/lib/supabase-auth-browser";

const VISITOR_INIT_PATH = "/api/notal/visitor";

let visitorInitPromise: Promise<void> | null = null;

export function notalCreditsHeaders(
  accessToken?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

/** HttpOnly ziyaretçi çerezini sunucuda oluşturur / doğrular */
export function ensureNotalVisitorCookie(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!visitorInitPromise) {
    visitorInitPromise = fetch(VISITOR_INIT_PATH, {
      method: "GET",
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Ziyaretçi kimliği oluşturulamadı.");
        }
      })
      .catch((err) => {
        visitorInitPromise = null;
        throw err;
      });
  }
  return visitorInitPromise;
}

export async function notalFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const session = await getNotalAuthSession();
  if (!session?.access_token) {
    if (typeof window !== "undefined") {
      window.location.href = buildLoginRedirectUrl();
    }
    throw new Error("AUTH_REQUIRED");
  }

  await ensureNotalVisitorCookie();

  const headers = {
    ...notalCreditsHeaders(session.access_token),
    ...(init?.headers as Record<string, string> | undefined),
  };

  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers,
  });

  if (response.status === 401) {
    const data = (await response.json().catch(() => ({}))) as {
      code?: string;
    };
    if (data.code === "auth_required" && typeof window !== "undefined") {
      window.location.href = buildLoginRedirectUrl();
    }
    throw new Error("AUTH_REQUIRED");
  }

  return response;
}
