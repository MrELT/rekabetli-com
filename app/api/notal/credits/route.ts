import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCredits, linkVisitorToUser } from "@/lib/notal-credits-server";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import {
  getVisitorIdFromRequest,
  resolveAuthenticatedIdentity,
} from "@/lib/notal-request-identity";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase yapılandırması eksik." },
      { status: 500 },
    );
  }

  const identity = await resolveAuthenticatedIdentity(request);
  if (!identity?.userId) {
    return notalAuthRequiredResponse();
  }

  const visitorId = getVisitorIdFromRequest(request);
  if (visitorId) {
    try {
      await linkVisitorToUser(supabase, identity.userId, visitorId);
    } catch (error) {
      console.warn("notal visitor link:", error);
    }
  }

  try {
    const credits = await getOrCreateCredits(supabase, identity);
    return NextResponse.json(credits);
  } catch (error) {
    console.error("notal credits GET:", error);
    return NextResponse.json(
      { error: "Hak bilgisi alınamadı." },
      { status: 500 },
    );
  }
}
