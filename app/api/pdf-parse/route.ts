import { NextRequest, NextResponse } from "next/server";
import { chunkText, isLowQualityChunk } from "@/lib/pdf-chunking";
import { looksLikeExamPdf } from "@/lib/pdf-exam-detect";
import { extractTextFromPdf } from "@/lib/pdf-extract";
import { MAX_FILE_BYTES } from "@/lib/pdf-ingest-shared";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
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

  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith(".pdf") || file.type !== "application/pdf") {
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
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const rawText = await extractTextFromPdf(buffer);

    const examMode = looksLikeExamPdf(rawText);
    const minText = examMode ? 80 : 100;
    const minChunkLen = examMode ? 40 : 80;

    if (!rawText || rawText.replace(/\s/g, "").length < minText) {
      return NextResponse.json(
        {
          error: examMode
            ? "PDF'den yeterli metin çıkarılamadı. Metin katmanı çok zayıf olabilir."
            : "PDF'den yeterli metin çıkarılamadı. Taranmış/görüntü tabanlı PDF olabilir.",
        },
        { status: 422 },
      );
    }

    const chunks = chunkText(rawText).filter(
      (c) => c.length >= minChunkLen && !isLowQualityChunk(c, examMode),
    );
    if (!chunks.length) {
      return NextResponse.json(
        { error: "Metin parçalara ayrılamadı." },
        { status: 422 },
      );
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileSize: file.size,
      charactersProcessed: rawText.length,
      chunkCount: chunks.length,
      chunks,
    });
  } catch (error) {
    console.error("PDF parse hatası:", error);
    return NextResponse.json(
      { error: "PDF okunurken hata oluştu. Dosyayı kontrol edip tekrar deneyin." },
      { status: 500 },
    );
  }
}
