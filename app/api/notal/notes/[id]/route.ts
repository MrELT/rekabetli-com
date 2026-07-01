import { NextRequest, NextResponse } from "next/server";
import { getNotalNoteById } from "@/lib/notal-notes-server";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import { resolveAuthenticatedIdentity } from "@/lib/notal-request-identity";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

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
    const note = await getNotalNoteById(supabase, id, identity);
    if (!note) {
      return NextResponse.json({ error: "Not bulunamadı." }, { status: 404 });
    }
    return NextResponse.json({ note });
  } catch (error) {
    console.error("notal note get:", error);
    return NextResponse.json(
      { error: "Not yüklenemedi." },
      { status: 500 },
    );
  }
}
