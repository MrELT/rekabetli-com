import { createHmac, timingSafeEqual } from "node:crypto";

function stateSecret(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "notal-dev-secret"
  );
}

export function signGoogleOAuthState(userId: string): string {
  const ts = Date.now().toString(36);
  const payload = `${userId}.${ts}`;
  const sig = createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyGoogleOAuthState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 3) return null;
    const [userId, ts, sig] = parts;
    if (!userId || !ts || !sig) return null;

    const payload = `${userId}.${ts}`;
    const expected = createHmac("sha256", stateSecret())
      .update(payload)
      .digest("base64url");

    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const ageMs = Date.now() - parseInt(ts, 36);
    if (!Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000) return null;

    return userId;
  } catch {
    return null;
  }
}
