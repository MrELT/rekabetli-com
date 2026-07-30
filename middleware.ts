import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getNotalAccessMode } from "@/lib/notal/access";

/**
 * NotAl erişim kapısı.
 * - off: herkese 404 (route'lar build'de yoksa zaten yok)
 * - admin / public: sayfa açılsın; API + AuthGate admin kontrolü yapar
 * - local/dev: access.ts zaten public döner
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isNotalPath =
    pathname === "/notal" ||
    pathname.startsWith("/notal/") ||
    pathname.startsWith("/api/notal/");

  if (!isNotalPath) return NextResponse.next();

  const mode = getNotalAccessMode();
  if (mode !== "off") return NextResponse.next();

  if (pathname.startsWith("/api/notal/")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.rewrite(new URL("/404", request.url));
}

export const config = {
  matcher: ["/notal", "/notal/:path*", "/api/notal/:path*"],
};
