import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { normalizeMetadataPayload } from "@/lib/pdf-metadata-map";

export const runtime = "nodejs";
export const maxDuration = 60;

const METADATA_MODEL = "gpt-4o-mini";
const MAX_PREVIEW_CHARS = 24_000;

const SYSTEM_PROMPT = `Sen akademik PDF belgelerinin kapak/ön sayfa metninden metadata çıkaran bir asistansın.
Verilen metinden yalnızca şu JSON alanlarını doldur:
- title: kitap, ders notu veya belgenin tam adı
- author: yazar, editör veya kurum adı
- category: akademik alan (ör. Fizik, Astronomi, Biyoloji, Matematik)
- type: belge türü — yalnızca şunlardan biri: "Kitap", "Makale", "Çıkmış Soru", "Sunum"

Emin değilsen makul tahmin yap; alanları boş bırakma.`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "OpenAI yapılandırması eksik." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON." }, { status: 400 });
  }

  const text =
    typeof body === "object" &&
    body !== null &&
    "text" in body &&
    typeof (body as { text: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";

  if (text.length < 40) {
    return NextResponse.json(
      { error: "Metadata için yeterli metin yok (en az 40 karakter)." },
      { status: 400 },
    );
  }

  const preview = text.slice(0, MAX_PREVIEW_CHARS);

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: METADATA_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `PDF ön sayfa metni:\n\n${preview}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return NextResponse.json(
        { error: "Metadata yanıtı boş." },
        { status: 502 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "Metadata JSON ayrıştırılamadı." },
        { status: 502 },
      );
    }

    const metadata = normalizeMetadataPayload(parsed);
    if (!metadata) {
      return NextResponse.json(
        { error: "Geçerli metadata üretilemedi." },
        { status: 502 },
      );
    }

    return NextResponse.json(metadata);
  } catch (error) {
    console.error("pdf-metadata hatası:", error);
    return NextResponse.json(
      { error: "Metadata çıkarımı başarısız." },
      { status: 500 },
    );
  }
}
