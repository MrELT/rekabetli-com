/**
 * NotAl erişim modu (Edge + Node uyumlu, ağır bağımlılık yok).
 *
 * - local/dev: her zaman açık
 * - production:
 *   NOTAL_ACCESS=admin  → admin_users / NOTAL_ADMIN_EMAILS (varsayılan)
 *   NOTAL_ACCESS=public → herkese açık
 *   NOTAL_ACCESS=off    → tamamen kapalı (404 + isteğe bağlı build dışı)
 *
 * Eski anahtar: NOTAL_LIVE_ENABLED=true → public
 */
export type NotalAccessMode = "off" | "admin" | "public";

export function getNotalAccessMode(): NotalAccessMode {
  if (process.env.NODE_ENV !== "production") return "public";

  const raw = (process.env.NOTAL_ACCESS || "").trim().toLowerCase();
  if (raw === "off" || raw === "admin" || raw === "public") return raw;

  if (process.env.NOTAL_LIVE_ENABLED === "true") return "public";

  // Canlıda varsayılan: yalnızca admin
  return "admin";
}

export function getNotalAdminEmails(): string[] {
  const fromEnv = process.env.NOTAL_ADMIN_EMAILS || "";
  const fromPublic = process.env.NEXT_PUBLIC_NOTAL_ADMIN_EMAILS || "";
  return `${fromEnv},${fromPublic}`
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isNotalAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = getNotalAdminEmails();
  if (!admins.length) return false;
  return admins.includes(email.trim().toLowerCase());
}

/** Production build'e NotAl route'larını dahil et? */
export function shouldIncludeNotalInBuild(): boolean {
  if (process.env.NOTAL_BUILD === "0") return false;
  if (process.env.NOTAL_BUILD === "1") return true;
  // off iken Vercel build'den çıkar → bellek/bundle tasarrufu
  if (process.env.VERCEL === "1" && getNotalAccessMode() === "off") {
    return false;
  }
  return true;
}
