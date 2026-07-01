import {
  getNotalAuthSession,
  refreshNotalAuthSession,
} from "@/lib/supabase-auth-browser";

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

/** API çağrısı — login'e yönlendirmez (döngüyü önler; AuthGate korur) */
export async function notalFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  allowRetry = true,
): Promise<Response> {
  const session = await getNotalAuthSession();
  if (!session?.access_token) {
    throw new Error("AUTH_REQUIRED");
  }

  await ensureNotalVisitorCookie();

  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (session.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch(input, {
    ...init,
    credentials: "include",
    headers,
  });

  if (response.status === 401 && allowRetry) {
    const refreshed = await refreshNotalAuthSession();
    if (refreshed?.access_token) {
      return notalFetch(input, init, false);
    }
  }

  return response;
}
