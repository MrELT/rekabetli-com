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

function buildEmailHtml(options: { siteUrl: string; payload: CampaignPayload; displayName: string }): string {
  const safeName = escapeHtml(options.displayName || "Kullanıcı");
  const safeSubject = escapeHtml(options.payload.subject);
  const safePreview = escapeHtml(options.payload.preview);
  const safeMessage = escapeHtml(options.payload.plainMessage).replace(/\n/g, "<br>");
  const safeButtonLabel = escapeHtml(options.payload.buttonLabel);
  const safeButtonUrl = escapeHtml(options.payload.buttonUrl);
  const safeSiteUrl = escapeHtml(options.siteUrl);

  return `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
  <table width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#0f172a;">
    <tr><td align="center">
      <table width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#1e293b;border-radius:14px;padding:28px;border:1px solid #334155;">
        <tr><td style="color:#e2e8f0;font-size:15px;line-height:1.6;">Merhaba ${safeName},</td></tr>
        <tr><td style="padding-top:12px;color:#f8fafc;font-size:24px;font-weight:700;">${safeSubject}</td></tr>
        <tr><td style="padding-top:10px;color:#94a3b8;font-size:14px;line-height:1.6;">${safePreview}</td></tr>
        <tr><td style="padding-top:16px;color:#cbd5e1;font-size:15px;line-height:1.7;">${safeMessage}</td></tr>
        <tr><td align="center" style="padding-top:24px;">
          <a href="${safeButtonUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
            ${safeButtonLabel}
          </a>
        </td></tr>
        <tr><td style="padding-top:18px;color:#64748b;font-size:12px;text-align:center;">
          rekabetli.com • <a href="${safeSiteUrl}" style="color:#60a5fa;">${safeSiteUrl}</a>
        </td></tr>
      </table>
    </td></tr>
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
    const selectedSet = new Set(payload.recipientUserIds);
    const recipients = users
      .filter((user) => selectedSet.has(user.id))
      .filter((user) => user.email && !user.banned_until)
      .map((user) => ({
        id: user.id,
        email: user.email as string,
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
        const html = buildEmailHtml({ siteUrl, payload, displayName: recipient.displayName });
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
