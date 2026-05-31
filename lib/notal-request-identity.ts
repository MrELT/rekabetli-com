import { NextRequest } from "next/server";
import {
  normalizeVisitorId,
  parseCreditIdentity,
  type CreditIdentity,
} from "@/lib/notal-credits-server";
import { NOTAL_VISITOR_COOKIE } from "@/lib/notal-visitor-cookie";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export function getVisitorIdFromRequest(request: NextRequest): string | null {
  const cookieVal = request.cookies.get(NOTAL_VISITOR_COOKIE)?.value;
  const fromCookie = normalizeVisitorId(cookieVal);
  if (fromCookie) return fromCookie;

  const headerVal = request.headers.get("x-notal-visitor-id");
  return normalizeVisitorId(headerVal);
}

export async function getUserIdFromRequest(
  request: NextRequest,
): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;

  const token = auth.slice(7).trim();
  if (!token) return null;

  const supabase = createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export async function resolveCreditIdentity(
  request: NextRequest,
): Promise<CreditIdentity | null> {
  const userId = await getUserIdFromRequest(request);
  const visitorId = getVisitorIdFromRequest(request);
  return parseCreditIdentity(userId, visitorId);
}

/** NotAl korumalı uçlar: yalnızca giriş yapmış kullanıcı */
export async function resolveAuthenticatedIdentity(
  request: NextRequest,
): Promise<CreditIdentity | null> {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return null;
  return { userId, visitorId: null };
}

export function identityRateLimitKey(identity: CreditIdentity): string {
  return identity.userId ?? identity.visitorId ?? "anonymous";
}
