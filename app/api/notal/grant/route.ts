import { NextRequest, NextResponse } from "next/server";
import { grantCreditsFromPdfDonation } from "@/lib/notal-credits-server";
import { claimCompletedPdfIngest } from "@/lib/notal-pdf-ingest-server";
import { enforceRateLimit } from "@/lib/notal-rate-limit";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import {
  identityRateLimitKey,
  resolveAuthenticatedIdentity,
} from "@/lib/notal-request-identity";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
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

  const limited = enforceRateLimit(
    request,
    "notal-grant",
    identityRateLimitKey(identity),
    8,
    60 * 60 * 1000,
  );
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  const ingestKey =
    typeof body === "object" &&
    body !== null &&
    "ingestKey" in body &&
    typeof (body as { ingestKey: unknown }).ingestKey === "string"
      ? (body as { ingestKey: string }).ingestKey
      : "";

  if (!ingestKey.trim()) {
    return NextResponse.json(
      { error: "PDF yükleme oturumu doğrulanamadı." },
      { status: 400 },
    );
  }

  try {
    const claimed = await claimCompletedPdfIngest(
      supabase,
      identity,
      ingestKey,
    );
    if (!claimed) {
      return NextResponse.json(
        {
          error:
            "Not hakkı tanımlanamadı. PDF arşive eklenmemiş veya hak zaten kullanılmış olabilir.",
        },
        { status: 403 },
      );
    }

    const result = await grantCreditsFromPdfDonation(supabase, identity);

    if (!result.granted) {
      return NextResponse.json({
        granted: false,
        message:
          "PDF arşive eklendi. Tüm deneme hak paketlerinizi kullandınız — uygulama geliştirme aşamasındadır.",
        credits: result.credits,
      });
    }

    return NextResponse.json({
      granted: true,
      message: "3 not oluşturma hakkı tanımlandı.",
      credits: result.credits,
    });
  } catch (error) {
    console.error("notal grant:", error);
    return NextResponse.json(
      { error: "Hak tanımlanamadı." },
      { status: 500 },
    );
  }
}
