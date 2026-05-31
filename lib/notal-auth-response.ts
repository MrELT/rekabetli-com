import { NextResponse } from "next/server";

export function notalAuthRequiredResponse() {
  return NextResponse.json(
    { error: "Bu işlem için giriş yapmalısınız.", code: "auth_required" },
    { status: 401 },
  );
}
