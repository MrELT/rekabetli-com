import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

import { ingestPdfForYksUnified } from "@/lib/ingestion/yks-unified-pipeline";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import { resolveAuthenticatedIdentity } from "@/lib/notal-request-identity";
import { MAX_FILE_BYTES } from "@/lib/pdf-upload-limits";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { YksCurriculum } from "@/lib/yks-chunks/types";
import { YKS_CURRICULA } from "@/lib/yks-chunks/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseCurriculumHint(value: FormDataEntryValue | null): YksCurriculum | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === "TYT" || normalized === "AYT") return normalized;
  if (normalized === "GENEL") return "genel";
  return YKS_CURRICULA.includes(normalized as YksCurriculum)
    ? (normalized as YksCurriculum)
    : undefined;
}

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

  const hintSubject =
    typeof formData.get("subject") === "string"
      ? String(formData.get("subject")).trim()
      : undefined;
  const hintCurriculum = parseCurriculumHint(formData.get("curriculum"));

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const result = await ingestPdfForYksUnified({
      buffer,
      fileName: file.name,
      supabase,
      openai,
      hintSubject: hintSubject || undefined,
      hintCurriculum,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[notal-admin/ingest-text] PDF işleme hatası:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Kitap ingest sırasında hata oluştu.",
      },
      { status: 500 },
    );
  }
}
