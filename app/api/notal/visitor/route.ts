import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizeVisitorId } from "@/lib/notal-credits-server";
import {
  NOTAL_VISITOR_COOKIE,
  visitorCookieOptions,
} from "@/lib/notal-visitor-cookie";
import { getVisitorIdFromRequest } from "@/lib/notal-request-identity";

export async function GET(request: NextRequest) {
  let visitorId = getVisitorIdFromRequest(request);
  if (!visitorId) {
    visitorId = randomUUID();
  } else if (!normalizeVisitorId(visitorId)) {
    visitorId = randomUUID();
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(NOTAL_VISITOR_COOKIE, visitorId, visitorCookieOptions());
  return response;
}
