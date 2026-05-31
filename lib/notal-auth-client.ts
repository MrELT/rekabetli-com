import { getNotalAuthSession } from "@/lib/supabase-auth-browser";

export function buildLoginRedirectUrl(returnPath?: string): string {
  const path =
    returnPath ??
    (typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "/notal");
  return `/login?redirect=${encodeURIComponent(path)}`;
}

export async function redirectToLoginIfNeeded(
  returnPath?: string,
): Promise<boolean> {
  const session = await getNotalAuthSession();
  if (session?.access_token) return false;
  window.location.href = buildLoginRedirectUrl(returnPath);
  return true;
}
