import { NextRequest, NextResponse } from "next/server";
import { listNotalNotes } from "@/lib/notal-notes-server";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import { resolveAuthenticatedIdentity } from "@/lib/notal-request-identity";
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
  if (!identity) {
    return notalAuthRequiredResponse();
  }

  try {
    const notes = await listNotalNotes(supabase, identity);
    return NextResponse.json({ notes });
  } catch (error) {
    console.error("notal notes list:", error);
    return NextResponse.json(
      { error: "Notlar yüklenemedi." },
      { status: 500 },
    );
  }
}
