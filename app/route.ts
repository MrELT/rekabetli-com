import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import {
  serializeForScriptTag,
  type HomeBentoPayload,
} from "@/lib/home-bento";
import { getCachedHomeBentoPayload } from "@/lib/home-bento-cache";

export const runtime = "nodejs";

function injectHomeBento(html: string, payload: HomeBentoPayload): string {
  const script = `<script>window.__HOME_BENTO__=${serializeForScriptTag(payload)};</script>`;
  if (html.includes("</head>")) {
    return html.replace("</head>", `${script}\n</head>`);
  }
  return `${script}\n${html}`;
}

/** Statik index.html — bento verisi sunucuda gömülür (ilk paint'te flash yok). */
export async function GET() {
  const html = readFileSync(
    join(process.cwd(), "public", "index.html"),
    "utf8",
  );

  let body = html;

  try {
    const bento = await getCachedHomeBentoPayload();
    if (bento) {
      body = injectHomeBento(body, bento);
    }
  } catch (error) {
    console.error("[home] bento inject failed:", error);
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
