import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Eski not üretim API'si geçici olarak askıda. Sınav hazırlık: POST /api/notal/exam-prep */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Not üretimi geçici olarak kapalı. /notal sayfasından «Sınava hazırlan» akışını kullanın.",
      code: "note_generation_paused",
    },
    { status: 503 },
  );
}
