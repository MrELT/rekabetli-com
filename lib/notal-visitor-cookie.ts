export const NOTAL_VISITOR_COOKIE = "notal_vid";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function visitorCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}
