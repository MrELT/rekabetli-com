import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

type CampaignPayload = {
  subject: string;
  preview: string;
  buttonLabel: string;
  buttonUrl: string;
  plainMessage: string;
  recipientUserIds: string[];
};

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey =
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey, serviceRoleKey };
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

async function collectRecipients(
  serviceClient: SupabaseClient,
  selectedUserIds: string[],
) {
  const selectedSet = new Set(selectedUserIds);
  const users: Array<{
    id: string;
    email?: string;
    banned_until?: string | null;
    user_metadata?: Record<string, unknown>;
  }> = [];

  for (let page = 1; page <= 10; page += 1) {
    const { data: usersData, error: usersError } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (usersError) throw new Error(`Kullanıcı listesi alınamadı: ${usersError.message}`);
    const batch = usersData.users || [];
    users.push(...batch);
    if (batch.length < 1000) break;
  }

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
    ]),
  );

  return users
    .filter((user) => selectedSet.has(user.id))
    .filter((user) => user.email && !user.banned_until)
    .map((user) => {
      const preference = preferenceByUserId.get(user.id) ?? {
        marketingEmailsEnabled: true,
        unsubscribeToken: null as string | null,
      };
      return {
        id: user.id,
        email: user.email as string,
        displayName:
          String(user.user_metadata?.display_name || user.user_metadata?.first_name || "").trim() ||
          (user.email as string).split("@")[0] ||
          "Kullanıcı",
        unsubscribeToken: preference.unsubscribeToken,
        marketingEmailsEnabled: preference.marketingEmailsEnabled,
      };
    });
}

async function triggerCampaignQueue(url: string, serviceRoleKey: string) {
  try {
    await fetch(`${url}/functions/v1/send-campaign-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "process_queue" }),
    });
  } catch (error) {
    console.warn("campaign queue trigger:", error);
  }
}

export async function POST(request: Request) {
  const config = getSupabaseConfig();
  if (!config) return jsonError("Sunucu yapılandırması eksik.", 500);
  if (!config.serviceRoleKey) return jsonError("Sunucu servis anahtarı eksik.", 500);

  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) return jsonError("Oturum gerekli.", 401);

  const userClient = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return jsonError("Oturum doğrulanamadı.", 401);

  const { data: adminRow, error: adminError } = await userClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    return jsonError("Bu işlem için admin yetkisi gerekli.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Geçersiz JSON.", 400);
  }

  let payload: CampaignPayload;
  try {
    payload = sanitizePayload(body);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Geçersiz istek.", 400);
  }

  const serviceClient = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const recipients = await collectRecipients(serviceClient, payload.recipientUserIds);
    if (!recipients.length) {
      return jsonError("Seçilen kullanıcılar için geçerli e-posta bulunamadı.", 400);
    }

    const { data: jobInsert, error: jobInsertError } = await serviceClient
      .from("campaign_mail_jobs")
      .insert({
        created_by: userData.user.id,
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
      return jsonError(
        `Kampanya kaydı oluşturulamadı: ${jobInsertError?.message || "Bilinmeyen hata"}`,
        500,
      );
    }

    const logRows = recipients.map((recipient) => ({
      job_id: jobInsert.id,
      user_id: recipient.id,
      email: recipient.email,
      display_name: recipient.displayName,
      unsubscribe_token: recipient.unsubscribeToken,
      status: recipient.marketingEmailsEnabled ? "queued" : "skipped",
      error_message: recipient.marketingEmailsEnabled ? null : "marketing_opt_out",
    }));

    const { error: logError } = await serviceClient.from("campaign_mail_logs").insert(logRows);
    if (logError) {
      return jsonError(`Kampanya kuyruğu yazılamadı: ${logError.message}`, 500);
    }

    void triggerCampaignQueue(config.url, config.serviceRoleKey);

    return Response.json({
      ok: true,
      queued: true,
      jobId: jobInsert.id,
      queuedCount: recipients.filter((recipient) => recipient.marketingEmailsEnabled).length,
      skippedCount: recipients.filter((recipient) => !recipient.marketingEmailsEnabled).length,
      total: recipients.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("campaign-mail enqueue:", message);
    return jsonError(message, 500);
  }
}
