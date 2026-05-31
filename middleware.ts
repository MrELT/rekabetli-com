import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** app/layout.tsx varken app/page.tsx yok; / isteğini statik ana sayfaya yönlendir */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL("/index.html", request.url));
  }
}

export const config = {
  matcher: ["/"],
};
