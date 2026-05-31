import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Statik index.html — middleware/cleanUrls çakışması olmadan ana sayfa */
export function GET() {
  const html = readFileSync(
    join(process.cwd(), "public", "index.html"),
    "utf8",
  );
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
