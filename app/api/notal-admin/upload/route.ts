import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { processPdfForImageRag } from "@/lib/pdf-processor";
import { MAX_FILE_BYTES } from "@/lib/pdf-upload-limits";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import { resolveAuthenticatedIdentity } from "@/lib/notal-request-identity";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY yapılandırması eksik." },
      { status: 500 },
    );
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY yapılandırması eksik." },
      { status: 500 },
    );
  }

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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Geçersiz form verisi." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "PDF dosyası gerekli." }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
    return NextResponse.json(
      { error: "Yalnızca PDF dosyaları kabul edilir." },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "Dosya boyutu en fazla 50 MB olabilir." },
      { status: 400 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const result = await processPdfForImageRag({
      buffer,
      fileName: file.name,
      supabase,
      openai,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[notal-admin/upload] PDF işleme hatası:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "PDF işlenirken hata oluştu.",
      },
      { status: 500 },
    );
  }
}
