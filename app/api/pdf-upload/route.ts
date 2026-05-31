import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { MAX_FILE_BYTES } from "@/lib/pdf-ingest-shared";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "academic_pdfs";

function safeStorageName(original: string): string {
  const base = original.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `${Date.now()}-${base || "document.pdf"}`;
}

export async function POST(request: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return NextResponse.json(
      { error: "Supabase service role yapılandırması eksik." },
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
    const path = `donations/${safeStorageName(file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload:", uploadError);
      return NextResponse.json(
        {
          error:
            uploadError.message.includes("Bucket not found")
              ? `Storage bucket "${BUCKET}" bulunamadı. Supabase SQL dosyasını çalıştırın.`
              : "PDF buluta yüklenemedi.",
        },
        { status: 500 },
      );
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);

    return NextResponse.json({
      success: true,
      pdf_url: urlData.publicUrl,
      storage_path: path,
    });
  } catch (error) {
    console.error("pdf-upload hatası:", error);
    return NextResponse.json(
      { error: "Yükleme sırasında hata oluştu." },
      { status: 500 },
    );
  }
}
