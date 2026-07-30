import {
  notalApiAuthErrorResponse,
  resolveNotalApiAuth,
} from "@/lib/notal/auth-server";
import { getNotalAccessMode } from "@/lib/notal/access";

export const runtime = "nodejs";

/** Hafif erişim kontrolü — AuthGate ve istemci için. */
export async function GET(request: Request) {
  const mode = getNotalAccessMode();
  if (mode === "off") {
    return Response.json({ error: "not_found", allowed: false }, { status: 404 });
  }

  if (mode === "public") {
    const result = await resolveNotalApiAuth(request);
    if (result.status === "unauthorized") {
      return Response.json({ error: "auth_required", allowed: false }, { status: 401 });
    }
    if (result.status === "forbidden") {
      return notalApiAuthErrorResponse(result);
    }
    return Response.json({
      allowed: true,
      mode,
      email: result.auth.user.email ?? null,
    });
  }

  // admin
  const result = await resolveNotalApiAuth(request);
  if (result.status !== "ok") {
    return notalApiAuthErrorResponse(result);
  }

  return Response.json({
    allowed: true,
    mode,
    email: result.auth.user.email ?? null,
  });
}
