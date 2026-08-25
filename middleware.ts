import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getNotalAccessMode } from "@/lib/notal/access";
import {
  SITE_MAINTENANCE_ENABLED,
  getMaintenancePageHtml,
  isMaintenanceBypassPath,
} from "@/lib/site-maintenance";

/**
 * 1) Site bakımı: tüm sayfalar kilitlenir (sorun çözülünce SITE_MAINTENANCE_ENABLED=false).
 * 2) NotAl erişim kapısı.
 * - off: herkese 404 (route'lar build'de yoksa zaten yok)
 * - admin / public: sayfa açılsın; API + AuthGate admin kontrolü yapar
 * - local/dev: access.ts zaten public döner
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (SITE_MAINTENANCE_ENABLED && !isMaintenanceBypassPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "maintenance", message: "Site şu anda düzenleniyor." },
        {
          status: 503,
          headers: {
            "Retry-After": "86400",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return new NextResponse(getMaintenancePageHtml(), {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": "86400",
        "Cache-Control": "no-store",
      },
    });
  }

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
