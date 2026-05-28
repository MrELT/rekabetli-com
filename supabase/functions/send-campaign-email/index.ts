import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = "rekabetli.com <info@rekabetli.com>";
const DEFAULT_SITE_URL = "https://rekabetli.com";
const SEND_DELAY_MS = 250;
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CampaignPayload = {
  subject: string;
  preview: string;
  buttonLabel: string;
  buttonUrl: string;
  plainMessage: string;
  recipientUserIds: string[];
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Ortam değişkeni eksik: ${name}`);
  return value;
}

function getSiteUrl(): string {
  const siteUrl = Deno.env.get("SITE_URL")?.trim() || DEFAULT_SITE_URL;
  return siteUrl.replace(/\/$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizePayload(payload: unknown): CampaignPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Geçersiz payload.");
  }

  const body = payload as Record<string, unknown>;
  const subject = String(body.subject || "").trim();
  const preview = String(body.preview || "").trim();
  const buttonLabel = String(body.buttonLabel || "").trim();
  const buttonUrl = String(body.buttonUrl || "").trim();
  const plainMessage = String(body.plainMessage || "").trim();
  const recipientUserIds = Array.isArray(body.recipientUserIds)
    ? body.recipientUserIds.map((id) => String(id).trim()).filter(Boolean)
    : [];

  if (!subject || !preview || !buttonLabel || !buttonUrl || !plainMessage) {
    throw new Error("Eksik alan: subject, preview, buttonLabel, buttonUrl, plainMessage.");
  }
  if (!recipientUserIds.length) {
    throw new Error("En az bir alıcı seçilmelidir.");
  }

  if (subject.length > 120 || preview.length > 240 || buttonLabel.length > 40 || plainMessage.length > 1200) {
    throw new Error("Metin uzunluğu sınırı aşıldı.");
  }

  if (!/^https?:\/\//i.test(buttonUrl)) {
    throw new Error("Buton linki http/https ile başlamalı.");
  }

  return { subject, preview, buttonLabel, buttonUrl, plainMessage, recipientUserIds };
}

function createAnonClient(authHeader: string): SupabaseClient {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
}

function createServiceClient(): SupabaseClient {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureAdminUser(authHeader: string): Promise<string> {
  const anonClient = createAnonClient(authHeader);
  const { data: authData, error: authError } = await anonClient.auth.getUser();
  if (authError || !authData.user) throw new Error("Oturum doğrulanamadı.");

  const { data: adminData, error: adminError } = await anonClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (adminError || !adminData) throw new Error("Bu işlem için admin yetkisi gerekli.");
  return authData.user.id;
}

function buildEmailHtml(options: {
  siteUrl: string;
  payload: CampaignPayload;
  displayName: string;
  unsubscribeUrl: string;
}): string {
  const safeName = escapeHtml(options.displayName || "Kullanıcı");
  const safeSubject = escapeHtml(options.payload.subject);
  const safePreview = escapeHtml(options.payload.preview);
  const safeMessage = escapeHtml(options.payload.plainMessage).replace(/\n/g, "<br>");
  const safeButtonLabel = escapeHtml(options.payload.buttonLabel);
  const safeButtonUrl = escapeHtml(options.payload.buttonUrl);
  const safeSiteUrl = escapeHtml(options.siteUrl.replace(/\/$/, ""));
  const safeUnsubscribeUrl = escapeHtml(options.unsubscribeUrl);
  const safeLogoUrl =
    "https://xtggaelcgimohftfupvo.supabase.co/storage/v1/object/public/logos/rekabetli.png";
  const safeLogoFallback =
    "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=160&q=80";

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>rekabetli.com — Kampanya Duyurusu</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0f172a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3); border: 1px solid #334155;">

          <tr>
            <td align="center" style="padding: 36px 36px 18px 36px;">
              <a href="${safeSiteUrl}" target="_blank" style="text-decoration: none;">
                <img src="${safeLogoUrl}" alt="Rekabetli Logo" width="160" style="display: block; border: 0; outline: none; text-decoration: none; margin: 0 auto;" onerror="this.src='${safeLogoFallback}'">
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding: 0 36px;">
              <div style="height: 1px; background-color: #334155;"></div>
            </td>
          </tr>

          <tr>
            <td style="padding: 28px 36px 34px 36px;">
              <p style="margin: 0 0 10px 0; color: #94a3b8; font-size: 14px; line-height: 1.6; text-align: center;">
                Merhaba <strong style="color: #e2e8f0;">${safeName}</strong>,
              </p>
              <h2 style="margin: 0 0 12px 0; color: #f8fafc; font-size: 25px; font-weight: 700; text-align: center; letter-spacing: -0.5px;">
                ${safeSubject}
              </h2>
              <p style="margin: 0 0 16px 0; color: #cbd5e1; font-size: 15px; line-height: 1.65; text-align: center;">
                ${safePreview}
              </p>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td style="background-color: #0f172a; border: 1px solid #334155; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0; padding: 16px 18px;">
                    <p style="margin: 0; color: #cbd5e1; font-size: 15px; line-height: 1.65;">
                      ${safeMessage}
                    </p>
                  </td>
                </tr>
              </table>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 18px;">
                <tr>
                  <td align="center" style="padding: 4px 0;">
                    <a href="${safeButtonUrl}" target="_blank" style="display: inline-block; padding: 14px 30px; background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35); letter-spacing: 0.2px;">
                      ${safeButtonLabel}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 6px 0; color: #64748b; font-size: 12px; line-height: 1.5; text-align: center;">
                Buton çalışmıyorsa aşağıdaki bağlantıyı kopyalayabilirsin:
              </p>
              <p style="margin: 0; font-size: 12px; text-align: center; word-break: break-all;">
                <a href="${safeButtonUrl}" target="_blank" style="color: #60a5fa; text-decoration: underline;">${safeButtonUrl}</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 18px 36px; background-color: #0f172a; text-align: center; border-top: 1px solid #334155;">
              <p style="margin: 0 0 4px 0; color: #475569; font-size: 12px; font-weight: 500;">
                © 2026 rekabetli.com. Tüm hakları saklıdır.
              </p>
              <p style="margin: 0; color: #334155; font-size: 11px;">
                Bu e-posta kampanya duyurusu için otomatik olarak gönderilmiştir.
                <a href="${safeSiteUrl}" target="_blank" style="color: #60a5fa; text-decoration: underline;">${safeSiteUrl}</a>
              </p>
              <p style="margin: 6px 0 0; color: #475569; font-size: 11px;">
                Kampanya e-postalarından çıkmak için
                <a href="${safeUnsubscribeUrl}" target="_blank" style="color: #60a5fa; text-decoration: underline;">abonelikten çık</a>.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Yalnızca POST istekleri kabul edilir." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authorization header eksik." }, 401);
    }

    const resendApiKey = requireEnv("RESEND_API_KEY");
    const serviceClient = createServiceClient();
    const siteUrl = getSiteUrl();
    const payload = sanitizePayload(await req.json());

    const adminUserId = await ensureAdminUser(authHeader);

    const { data: usersData, error: usersError } = await serviceClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (usersError) throw new Error(`Kullanıcı listesi alınamadı: ${usersError.message}`);

    const users = usersData.users || [];
    const selectedUserIds = payload.recipientUserIds;
    const selectedSet = new Set(selectedUserIds);
    const { data: preferenceRows, error: preferenceError } = await serviceClient
      .from("email_preferences")
      .select("user_id, marketing_emails_enabled, unsubscribe_token")
      .in("user_id", selectedUserIds);

    if (preferenceError) {
      throw new Error(`E-posta tercihleri alınamadı: ${preferenceError.message}`);
    }

    const preferenceByUserId = new Map(
      (preferenceRows ?? []).map((row) => [
        row.user_id,
        {
          marketingEmailsEnabled: row.marketing_emails_enabled !== false,
          unsubscribeToken: row.unsubscribe_token ? String(row.unsubscribe_token) : null,
        },
      ])
    );

    const recipients = users
      .filter((user) => selectedSet.has(user.id))
      .filter((user) => user.email && !user.banned_until)
      .map((user) => ({
        id: user.id,
        email: user.email as string,
        preference: preferenceByUserId.get(user.id) ?? {
          marketingEmailsEnabled: true,
          unsubscribeToken: null,
        },
        displayName:
          user.user_metadata?.display_name ||
          user.user_metadata?.first_name ||
          (user.email as string).split("@")[0] ||
          "Kullanıcı",
      }));

    if (!recipients.length) {
      throw new Error("Seçilen kullanıcılar için geçerli e-posta bulunamadı.");
    }

    const { data: jobInsert, error: jobInsertError } = await serviceClient
      .from("campaign_mail_jobs")
      .insert({
        created_by: adminUserId,
        subject: payload.subject,
        preview: payload.preview,
        button_label: payload.buttonLabel,
        button_url: payload.buttonUrl,
        plain_message: payload.plainMessage,
        status: "queued",
      })
      .select("id")
      .single();
    if (jobInsertError || !jobInsert?.id) {
      throw new Error(`Kampanya kaydı oluşturulamadı: ${jobInsertError?.message || "Bilinmeyen hata"}`);
    }

    let sentCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
      try {
        if (!recipient.preference.marketingEmailsEnabled) {
          await serviceClient.from("campaign_mail_logs").insert({
            job_id: jobInsert.id,
            user_id: recipient.id,
            email: recipient.email,
            status: "skipped",
            error_message: "marketing_opt_out",
          });
          continue;
        }

        const unsubscribeUrl = recipient.preference.unsubscribeToken
          ? `${siteUrl}/unsubscribe?token=${encodeURIComponent(recipient.preference.unsubscribeToken)}`
          : `${siteUrl}/unsubscribe`;

        const html = buildEmailHtml({
          siteUrl,
          payload,
          displayName: recipient.displayName,
          unsubscribeUrl,
        });
        await sendEmailViaResend({
          apiKey: resendApiKey,
          to: recipient.email,
          subject: payload.subject,
          html,
        });

        sentCount += 1;
        await serviceClient.from("campaign_mail_logs").insert({
          job_id: jobInsert.id,
          user_id: recipient.id,
          email: recipient.email,
          status: "sent",
        });
      } catch (sendError) {
        failedCount += 1;
        await serviceClient.from("campaign_mail_logs").insert({
          job_id: jobInsert.id,
          user_id: recipient.id,
          email: recipient.email,
          status: "failed",
          error_message: sendError instanceof Error ? sendError.message : String(sendError),
        });
      }

      await delay(SEND_DELAY_MS);
    }

    const finalStatus = failedCount > 0 && sentCount === 0 ? "failed" : "completed";
    await serviceClient
      .from("campaign_mail_jobs")
      .update({ status: finalStatus, sent_count: sentCount, failed_count: failedCount })
      .eq("id", jobInsert.id);

    return jsonResponse({
      ok: true,
      jobId: jobInsert.id,
      sentCount,
      failedCount,
      total: recipients.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("send-campaign-email error:", message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
