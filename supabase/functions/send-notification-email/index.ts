import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = "rekabetli.com <info@rekabetli.com>";
const LOGO_URL =
  "https://xtggaelcgimohftfupvo.supabase.co/storage/v1/object/public/logos/rekabetli.png";
const LOGO_FALLBACK_URL =
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=160&q=80";
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_EMAILS = 2;
const DEFAULT_SITE_URL = "https://rekabetli.com";

function getSiteUrl(): string {
  const siteUrl = Deno.env.get("SITE_URL")?.trim() || DEFAULT_SITE_URL;
  return siteUrl.replace(/\/$/, "");
}

type NotificationType =
  | "comment"
  | "like"
  | "community_join_request"
  | "community_join_rejected";

interface NotificationRecord {
  id: string;
  user_id: string;
  actor_id: string | null;
  actor_name: string;
  type: NotificationType;
  post_id: string | null;
  comment_id: string | null;
  community_id: string | null;
  join_request_id: string | null;
  read_at: string | null;
  created_at: string;
  email_sent?: boolean;
}

interface DatabaseWebhookPayload {
  type?: string;
  table?: string;
  schema?: string;
  record?: NotificationRecord;
  old_record?: NotificationRecord | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Ortam değişkeni eksik: ${name}`);
  }
  return value;
}

function createAdminClient(): SupabaseClient {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseNotificationFromRequest(body: unknown): NotificationRecord | null {
  if (!body || typeof body !== "object") return null;

  const payload = body as DatabaseWebhookPayload & NotificationRecord;

  if (payload.record && typeof payload.record === "object" && payload.record.id) {
    return payload.record as NotificationRecord;
  }

  if (payload.id && payload.user_id && payload.type) {
    return payload as NotificationRecord;
  }

  return null;
}

function buildNotificationMessage(record: NotificationRecord): string {
  const name = record.actor_name?.trim() || "Biri";

  switch (record.type) {
    case "comment":
      return `${name} sorunuza yanıt verdi.`;
    case "community_join_request":
      return `${name} topluluğunuza katılmak istiyor.`;
    case "community_join_rejected":
      return `${name} topluluğuna katılma isteğiniz reddedildi.`;
    case "like":
    default:
      return `${name} sorunuzu beğendi.`;
  }
}

function buildNotificationLink(record: NotificationRecord, siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, "");

  if (record.type === "community_join_request") {
    if (record.community_id) {
      return `${base}//community?id=${encodeURIComponent(record.community_id)}`;
    }
    return `${base}//communities`;
  }

  if (record.type === "community_join_rejected") {
    if (record.community_id) {
      return `${base}//communities?community=${encodeURIComponent(record.community_id)}`;
    }
    return `${base}//communities`;
  }

  const tab = "questions";
  const postId = record.post_id ?? "";
  const commentId = record.type === "comment" ? (record.comment_id ?? "") : "";

  const params = new URLSearchParams({ tab });
  if (postId) params.set("post", postId);
  if (commentId) params.set("comment", commentId);

  return `${base}//profile?${params.toString()}`;
}

function buildEmailHtml(options: {
  recipientName: string;
  message: string;
  actionUrl: string;
  siteUrl: string;
}): string {
  const kullaniciAdi = escapeHtml(options.recipientName || "Kullanıcı");
  const bildirimIcerigi = escapeHtml(options.message);
  const platformUrl = escapeHtml(options.actionUrl);
  const homeUrl = escapeHtml(options.siteUrl.replace(/\/$/, ""));
  const safeLogoUrl = escapeHtml(LOGO_URL);
  const safeLogoFallback = escapeHtml(LOGO_FALLBACK_URL);

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>rekabetli.com — Yeni bildirim</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0f172a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3); border: 1px solid #334155;">

          <tr>
            <td align="center" style="padding: 40px 40px 20px 40px;">
              <a href="${homeUrl}" target="_blank" style="text-decoration: none;">
                <img src="${safeLogoUrl}" alt="Rekabetli Logo" width="160" style="display: block; border: 0; outline: none; text-decoration: none; margin: 0 auto;" onerror="this.src='${safeLogoFallback}'">
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding: 0 40px;">
              <div style="height: 1px; background-color: #334155;"></div>
            </td>
          </tr>

          <tr>
            <td style="padding: 30px 40px 40px 40px;">
              <h2 style="margin: 0 0 16px 0; color: #f8fafc; font-size: 24px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
                Yeni bildirimin var 🔔
              </h2>
              <p style="margin: 0 0 12px 0; color: #94a3b8; font-size: 15px; line-height: 1.6; text-align: center;">
                Merhaba <strong style="color: #e2e8f0;">${kullaniciAdi}</strong>, platformda senin için yeni bir gelişme var:
              </p>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td style="background-color: #0f172a; border: 1px solid #334155; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0; padding: 16px 20px;">
                    <p style="margin: 0; color: #cbd5e1; font-size: 15px; line-height: 1.6; font-style: italic; text-align: center;">
                      &quot;${bildirimIcerigi}&quot;
                    </p>
                  </td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center" style="padding: 4px 0;">
                    <a href="${platformUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35); letter-spacing: 0.3px;">
                      Platforma Git
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 8px 0; color: #64748b; font-size: 13px; line-height: 1.5; text-align: center;">
                Buton çalışmıyorsa aşağıdaki bağlantıyı tarayıcına yapıştırabilirsin:
              </p>
              <p style="margin: 0; font-size: 12px; text-align: center; word-break: break-all;">
                <a href="${platformUrl}" target="_blank" style="color: #3b82f6; text-decoration: underline;">${platformUrl}</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 40px; background-color: #0f172a; text-align: center; border-top: 1px solid #334155;">
              <p style="margin: 0 0 4px 0; color: #475569; font-size: 12px; font-weight: 500;">
                © 2026 rekabetli.com. Tüm hakları saklıdır.
              </p>
              <p style="margin: 0; color: #334155; font-size: 11px;">
                Bu e-posta, rekabetli.com bildirim sisteminden otomatik olarak gönderilmiştir.
                <a href="${homeUrl}" target="_blank" style="color: #3b82f6; text-decoration: underline;">${homeUrl}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function getRecipientProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ email: string; displayName: string }> {
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);

  if (userError) {
    throw new Error(`Kullanıcı e-postası alınamadı: ${userError.message}`);
  }

  const email = userData.user?.email?.trim();
  if (!email) {
    throw new Error(`Kullanıcı e-postası bulunamadı (user_id: ${userId})`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  const displayName =
    profile?.display_name?.trim() ||
    userData.user?.user_metadata?.first_name ||
    email.split("@")[0] ||
    "Kullanıcı";

  return { email, displayName };
}

async function countRecentEmailsSent(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("email_sent", true)
    .gte("created_at", since);

  if (error) {
    throw new Error(`Rate limit sayımı başarısız: ${error.message}`);
  }

  return count ?? 0;
}

async function sendEmailViaResend(options: {
  apiKey: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [options.to],
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend API hatası (${response.status}): ${errorText}`);
  }
}

async function markNotificationEmailSent(
  supabase: SupabaseClient,
  notificationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ email_sent: true })
    .eq("id", notificationId);

  if (error) {
    throw new Error(`email_sent güncellenemedi: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Yalnızca POST istekleri kabul edilir." }, 405);
  }

  try {
    const resendApiKey = requireEnv("RESEND_API_KEY");
    const supabase = createAdminClient();
    const siteUrl = getSiteUrl();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      console.error("Geçersiz JSON gövdesi");
      return jsonResponse({ error: "Geçersiz JSON gövdesi" }, 400);
    }

    const notification = parseNotificationFromRequest(body);
    if (!notification?.id || !notification.user_id || !notification.type) {
      console.error("Webhook payload geçersiz:", body);
      return jsonResponse({ error: "Bildirim kaydı payload içinde bulunamadı" }, 400);
    }

    if (notification.email_sent === true) {
      console.log(`Bildirim ${notification.id} için e-posta zaten gönderilmiş, atlanıyor.`);
      return jsonResponse({ ok: true, skipped: true, reason: "already_sent" });
    }

    console.log(
      `Bildirim işleniyor: id=${notification.id}, user_id=${notification.user_id}, type=${notification.type}`,
    );

    const recentEmailCount = await countRecentEmailsSent(supabase, notification.user_id);
    if (recentEmailCount >= RATE_LIMIT_MAX_EMAILS) {
      console.log(
        `Rate limit aşıldı: user_id=${notification.user_id}, son 1 saatte ${recentEmailCount} e-posta gönderildi.`,
      );
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "rate_limit",
        message: "Rate limit aşıldı",
        recentEmailCount,
      });
    }

    const { email, displayName } = await getRecipientProfile(supabase, notification.user_id);
    const message = buildNotificationMessage(notification);
    const actionUrl = buildNotificationLink(notification, siteUrl);
    console.log(`E-posta linkleri siteUrl=${siteUrl}, actionUrl=${actionUrl}`);

    const html = buildEmailHtml({
      recipientName: displayName,
      message,
      actionUrl,
      siteUrl,
    });

    await sendEmailViaResend({
      apiKey: resendApiKey,
      to: email,
      subject: "rekabetli.com — Yeni bildiriminiz var",
      html,
    });

    await markNotificationEmailSent(supabase, notification.id);

    console.log(`E-posta gönderildi: notification_id=${notification.id}, to=${email}`);

    return jsonResponse({
      ok: true,
      sent: true,
      notificationId: notification.id,
      recipient: email,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("send-notification-email hatası:", message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
