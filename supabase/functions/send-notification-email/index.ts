import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = "rekabetli.com <info@rekabetli.com>";
const DEFAULT_SITE_URL = "https://rekabetli.com";
/** Resend varsayılan: 5 istek/saniye (Settings → Usage). Secret: RESEND_MAX_PER_SECOND */
const DEFAULT_RESEND_MAX_PER_SECOND = 5;
const DEFAULT_MAX_NOTIFICATION_AGE_HOURS = 24;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_EMAILS = 2;
const RATE_LIMIT_RETRY_MS = 30 * 60 * 1000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getResendMaxPerSecond(): number {
  const raw = Deno.env.get("RESEND_MAX_PER_SECOND")?.trim();
  if (!raw) return DEFAULT_RESEND_MAX_PER_SECOND;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RESEND_MAX_PER_SECOND;
  return Math.min(n, 20);
}

/** Resend saniye başına limitin hemen altında kal (ör. 5/s → 220 ms aralık) */
function getSendDelayMs(): number {
  const override = Deno.env.get("RESEND_SEND_DELAY_MS")?.trim();
  if (override) {
    const ms = Number.parseInt(override, 10);
    if (Number.isFinite(ms) && ms >= 100) return ms;
  }
  const perSec = getResendMaxPerSecond();
  return Math.max(150, Math.ceil(1000 / perSec) + 25);
}

/** Cron başına işlenecek mail (Edge Function ~60s; 5/s × 55s ≈ 275) */
function getQueueBatchSize(): number {
  const raw = Deno.env.get("RESEND_QUEUE_BATCH_SIZE")?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 500);
  }
  return getResendMaxPerSecond() * 55;
}

function getMaxNotificationAgeHours(): number {
  const raw = Deno.env.get("NOTIFICATION_EMAIL_MAX_AGE_HOURS")?.trim();
  if (!raw) return DEFAULT_MAX_NOTIFICATION_AGE_HOURS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_NOTIFICATION_AGE_HOURS;
  return Math.min(n, 24 * 30);
}

function isNotificationTooOld(record: NotificationRecord): boolean {
  const createdAt = new Date(record.created_at).getTime();
  if (!Number.isFinite(createdAt)) return true;
  const maxAgeMs = getMaxNotificationAgeHours() * 60 * 60 * 1000;
  return Date.now() - createdAt > maxAgeMs;
}

class ResendRateLimitError extends Error {
  retryAfterSec: number;

  constructor(retryAfterSec: number, message: string) {
    super(message);
    this.name = "ResendRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

function getSiteUrl(): string {
  const siteUrl = Deno.env.get("SITE_URL")?.trim() || DEFAULT_SITE_URL;
  return siteUrl.replace(/\/$/, "");
}

/** E-posta şablonları: önce EMAIL_LOGO_URL, yoksa kendi domainimizdeki statik asset */
function getEmailLogoUrl(siteUrl: string): string {
  const override = Deno.env.get("EMAIL_LOGO_URL")?.trim();
  if (override) return override.replace(/\/$/, "");
  return `${siteUrl.replace(/\/$/, "")}/assets/rekabetli.png`;
}

function getEmailLogoFallbackUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/$/, "")}/assets/rekabetli_logo.png`;
}

type NotificationType =
  | "comment"
  | "like"
  | "answer_reply"
  | "community_join_request"
  | "community_join_rejected"
  | "community_post"
  | "mentor_package_request"
  | "mentor_student_message"
  | "mentor_mentor_reply"
  | "mentor_meeting_proposal"
  | "mentor_meeting_confirmed"
  | "mentor_meeting_reminder_1d"
  | "mentor_meeting_reminder_30m"
  | "mentor_package_purchased"
  | "mentor_package_sale";

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
  mentor_id: string | null;
  package_request_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  meeting_proposal_id?: string | null;
  enrollment_id?: string | null;
  body_text?: string | null;
  read_at: string | null;
  created_at: string;
  email_sent?: boolean;
}

interface EmailPreferenceRow {
  user_id: string;
  notification_emails_enabled: boolean;
  unsubscribe_token: string | null;
}

interface QueueRow {
  id: string;
  notification_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  scheduled_at: string;
  processed_at: string | null;
  created_at: string;
}

interface DatabaseWebhookPayload {
  type?: string;
  table?: string;
  schema?: string;
  record?: NotificationRecord;
  old_record?: NotificationRecord | null;
}

interface RequestBody {
  action?: string;
  records?: unknown[];
  notifications?: unknown[];
  data?: unknown[];
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

function verifyServiceRole(req: Request): boolean {
  const auth = req.headers.get("Authorization")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!auth || !serviceRoleKey) return false;
  return auth === `Bearer ${serviceRoleKey}`;
}

/** Dashboard Cron / pg_cron — service role yerine CRON_SECRET secret kullanın */
function verifyCronSecret(req: Request, body: unknown): boolean {
  const expected = Deno.env.get("CRON_SECRET")?.trim();
  if (!expected) return false;

  const headerSecret = req.headers.get("x-cron-secret")?.trim();
  if (headerSecret && headerSecret === expected) return true;

  if (body && typeof body === "object") {
    const fromBody = (body as { cron_secret?: unknown }).cron_secret;
    if (typeof fromBody === "string" && fromBody.trim() === expected) return true;
  }

  return false;
}

function canInvokePrivilegedEmailEndpoint(req: Request, body: unknown): boolean {
  return verifyServiceRole(req) || verifyCronSecret(req, body);
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

function parseNotificationsFromRequest(body: unknown): NotificationRecord[] {
  if (Array.isArray(body)) {
    return body
      .map((item) => parseNotificationFromRequest(item))
      .filter((record): record is NotificationRecord => Boolean(record));
  }

  if (body && typeof body === "object") {
    const payload = body as RequestBody;
    const batch = payload.records || payload.notifications || payload.data;
    if (Array.isArray(batch)) {
      return batch
        .map((item) => parseNotificationFromRequest(item))
        .filter((record): record is NotificationRecord => Boolean(record));
    }
  }

  const single = parseNotificationFromRequest(body);
  return single ? [single] : [];
}

function isProcessQueueRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const action = (body as RequestBody).action?.trim().toLowerCase();
  return action === "process_queue" || action === "process-queue";
}

function isSafeUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function joinSitePath(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function buildNotificationMessage(record: NotificationRecord): string {
  const custom = record.body_text?.trim();
  if (custom) return custom;

  const name = record.actor_name?.trim() || "Biri";

  switch (record.type) {
    case "comment":
      return `${name} sorunuza yanıt verdi.`;
    case "answer_reply":
      return `${name} yanıtınıza yorum yaptı.`;
    case "community_join_request":
      return `${name} topluluğunuza katılmak istiyor.`;
    case "community_join_rejected":
      return `${record.actor_name?.trim() || "Topluluk"} topluluğuna katılma isteğiniz reddedildi.`;
    case "community_post":
      return `${name} topluluğunuzda yeni bir paylaşım yaptı.`;
    case "mentor_package_request":
      return `${name} paketiniz için ön talep oluşturdu.`;
    case "mentor_student_message":
      return `${name} size bir soru sordu.`;
    case "mentor_mentor_reply":
      return `${name} sorunuza yanıt verdi.`;
    case "mentor_meeting_proposal":
      return `${name} size görüşme zamanı teklifi gönderdi.`;
    case "mentor_meeting_confirmed":
      return `${name} görüşme zamanınızı onayladı.`;
    case "mentor_meeting_postpone":
      return record.body_text || `${name} görüşmeyi ertelemek istiyor.`;
    case "mentor_meeting_refund_requested":
      return record.body_text || "Görüşme için iade talebi oluşturuldu.";
    case "mentor_meeting_reminder_1d":
      return "Yarın görüşmeniz var.";
    case "mentor_meeting_reminder_30m":
      return "Görüşmeniz 30 dakika sonra.";
    case "mentor_package_purchased":
      return "Paket satın alımınız tamamlandı. Danışman panelinizden ilk görüşmenizi planlayabilirsiniz.";
    case "mentor_package_sale":
      return `${name} paketinizi satın aldı. Lütfen en kısa sürede ilk görüşmeyi planlayın.`;
    case "mentor_package_refund_requested":
      return record.body_text || `${name} paketiniz için iade talep etti.`;
    case "mentor_package_refunded":
      return record.body_text || "Paket iadeniz işlendi.";
    case "like":
      return `${name} sorunuzu beğendi.`;
    default:
      return `${name} yeni bir bildirim gönderdi.`;
  }
}

function buildNotificationLink(record: NotificationRecord, siteUrl: string): string {
  if (record.type === "mentor_package_purchased") {
    const enrollmentId = record.enrollment_id;
    if (isSafeUuid(enrollmentId)) {
      return joinSitePath(
        siteUrl,
        `/ogrenci-sayfam#kayit-${encodeURIComponent(enrollmentId)}`,
      );
    }
    return joinSitePath(siteUrl, "/ogrenci-sayfam");
  }

  if (record.type === "mentor_package_sale") {
    const params = new URLSearchParams({ openSchedule: "1", fromSale: "1" });
    if (isSafeUuid(record.enrollment_id)) {
      params.set("enrollment", record.enrollment_id);
    } else if (isSafeUuid(record.actor_id)) {
      params.set("scheduleStudent", record.actor_id);
    }
    return joinSitePath(siteUrl, `/mentor-sayfam?${params.toString()}`);
  }

  if (record.type === "mentor_package_request") {
    const params = new URLSearchParams({ inbox: "requests" });
    if (isSafeUuid(record.package_request_id)) {
      params.set("request", record.package_request_id);
    }
    return joinSitePath(siteUrl, `/mentor-sayfam?${params.toString()}`);
  }

  if (record.type === "mentor_student_message") {
    const params = new URLSearchParams({ inbox: "messages" });
    if (isSafeUuid(record.conversation_id)) {
      params.set("conversation", record.conversation_id);
    }
    if (isSafeUuid(record.message_id)) {
      params.set("message", record.message_id);
    }
    return joinSitePath(siteUrl, `/mentor-sayfam?${params.toString()}`);
  }

  if (record.type === "mentor_mentor_reply") {
    const params = new URLSearchParams({ openMessages: "1" });
    if (isSafeUuid(record.conversation_id)) {
      params.set("conversation", record.conversation_id);
    }
    if (isSafeUuid(record.message_id)) {
      params.set("message", record.message_id);
    }
    if (isSafeUuid(record.enrollment_id)) {
      const query = params.toString();
      return joinSitePath(
        siteUrl,
        query
          ? `/ogrenci-sayfam?${query}#kayit-${encodeURIComponent(record.enrollment_id)}`
          : `/ogrenci-sayfam#kayit-${encodeURIComponent(record.enrollment_id)}`,
      );
    }
    const query = params.toString();
    return joinSitePath(siteUrl, query ? `/ogrenci-sayfam?${query}` : "/ogrenci-sayfam");
  }

  if (record.type === "mentor_package_refund_requested") {
    return joinSitePath(siteUrl, "/mentor-sayfam#ogrenciler");
  }

  if (record.type === "mentor_package_refunded") {
    return joinSitePath(siteUrl, "/ogrenci-sayfam#cuzdanim");
  }

  if (
    record.type === "mentor_meeting_proposal" ||
    record.type === "mentor_meeting_confirmed" ||
    record.type === "mentor_meeting_postpone" ||
    record.type === "mentor_meeting_refund_requested" ||
    record.type === "mentor_meeting_reminder_1d" ||
    record.type === "mentor_meeting_reminder_30m"
  ) {
    const enrollmentId = record.enrollment_id;
    if (isSafeUuid(enrollmentId)) {
      return joinSitePath(
        siteUrl,
        `/ogrenci-sayfam#kayit-${encodeURIComponent(enrollmentId)}`,
      );
    }
    return joinSitePath(siteUrl, "/ogrenci-sayfam");
  }

  if (record.type === "community_join_request") {
    if (record.community_id) {
      return joinSitePath(
        siteUrl,
        `/community?id=${encodeURIComponent(record.community_id)}`,
      );
    }
    return joinSitePath(siteUrl, "/communities");
  }

  if (record.type === "community_join_rejected") {
    if (record.community_id) {
      return joinSitePath(
        siteUrl,
        `/communities?community=${encodeURIComponent(record.community_id)}`,
      );
    }
    return joinSitePath(siteUrl, "/communities");
  }

  if (
    record.type === "comment" ||
    record.type === "like" ||
    record.type === "answer_reply" ||
    record.type === "community_post"
  ) {
    const params = new URLSearchParams();
    if (isSafeUuid(record.community_id)) {
      params.set("id", record.community_id);
    }
    if (isSafeUuid(record.post_id)) {
      params.set("post", record.post_id);
    }
    if (isSafeUuid(record.comment_id)) {
      params.set("comment", record.comment_id);
    }

    if (isSafeUuid(record.community_id)) {
      const query = params.toString();
      return query
        ? joinSitePath(siteUrl, `/community?${query}`)
        : joinSitePath(siteUrl, "/communities");
    }

    const query = params.toString();
    return query ? joinSitePath(siteUrl, `/?${query}`) : joinSitePath(siteUrl, "/");
  }

  return joinSitePath(siteUrl, "/");
}

function isPackagePurchaseType(type: NotificationType): boolean {
  return type === "mentor_package_purchased" || type === "mentor_package_sale";
}

function isSafeExternalUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

interface PackageOrderInvoiceContext {
  hostedUrl: string | null;
  pdfUrl: string | null;
  invoiceId: string | null;
  packageTitle: string | null;
}

interface ResendAttachment {
  filename: string;
  content: string;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46;
}

function sanitizePdfFilename(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^\w\u00C0-\u024F\s.-]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return cleaned || "paket";
}

async function downloadPdfFromUrl(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return isPdfBytes(bytes) ? bytes : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("invoice pdf download failed:", url, message);
    return null;
  }
}

async function downloadStripeInvoicePdfForEmail(
  context: PackageOrderInvoiceContext,
): Promise<ResendAttachment | null> {
  let bytes: Uint8Array | null = null;

  if (context.pdfUrl) {
    bytes = await downloadPdfFromUrl(context.pdfUrl);
  }

  if (!bytes && context.invoiceId) {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
    if (stripeSecretKey?.startsWith("sk_")) {
      try {
        const stripe = new Stripe(stripeSecretKey);
        const invoice = await stripe.invoices.retrieve(context.invoiceId);
        if (invoice.invoice_pdf) {
          bytes = await downloadPdfFromUrl(invoice.invoice_pdf);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("stripe invoice pdf retrieve failed:", context.invoiceId, message);
      }
    }
  }

  if (!bytes) return null;

  const titlePart = context.packageTitle
    ? sanitizePdfFilename(context.packageTitle)
    : "paket";
  const invoicePart = context.invoiceId
    ? context.invoiceId.replace(/^in_/, "")
    : "fatura";

  return {
    filename: `rekabetli-fatura-${titlePart}-${invoicePart}.pdf`,
    content: uint8ArrayToBase64(bytes),
  };
}

async function fetchPackageOrderInvoiceContext(
  supabase: SupabaseClient,
  notification: NotificationRecord,
): Promise<PackageOrderInvoiceContext> {
  if (notification.type !== "mentor_package_purchased" || !isSafeUuid(notification.enrollment_id)) {
    return { hostedUrl: null, pdfUrl: null, invoiceId: null, packageTitle: null };
  }

  const { data, error } = await supabase
    .from("package_orders")
    .select(
      "stripe_invoice_id, stripe_hosted_invoice_url, stripe_invoice_pdf_url, package_title",
    )
    .eq("user_id", notification.user_id)
    .eq("enrollment_id", notification.enrollment_id)
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      stripe_invoice_id: string | null;
      stripe_hosted_invoice_url: string | null;
      stripe_invoice_pdf_url: string | null;
      package_title: string | null;
    }>();

  if (error) {
    console.warn("package_orders invoice lookup failed:", notification.id, error.message);
    return { hostedUrl: null, pdfUrl: null, invoiceId: null, packageTitle: null };
  }

  return {
    hostedUrl: isSafeExternalUrl(data?.stripe_hosted_invoice_url)
      ? data!.stripe_hosted_invoice_url
      : null,
    pdfUrl: isSafeExternalUrl(data?.stripe_invoice_pdf_url) ? data!.stripe_invoice_pdf_url : null,
    invoiceId: data?.stripe_invoice_id?.trim() || null,
    packageTitle: data?.package_title?.trim() || null,
  };
}

function buildEmailSubject(record: NotificationRecord, invoicePdfAttached = false): string {
  switch (record.type) {
    case "mentor_package_purchased":
      return invoicePdfAttached
        ? "rekabetli.com — Paket satın alımınız tamamlandı (fatura ektedir)"
        : "rekabetli.com — Paket satın alımınız tamamlandı";
    case "mentor_package_sale":
      return "rekabetli.com — Yeni paket satışı: ilk görüşmeyi planlayın";
    default:
      return "rekabetli.com — Yeni bildiriminiz var";
  }
}

function buildPurchaseEmailHtml(options: {
  recipientName: string;
  record: NotificationRecord;
  message: string;
  actionUrl: string;
  siteUrl: string;
  unsubscribeUrl: string;
  invoiceHostedUrl?: string | null;
  invoicePdfUrl?: string | null;
  invoicePdfAttached?: boolean;
}): string {
  const kullaniciAdi = escapeHtml(options.recipientName || "Kullanıcı");
  const bildirimIcerigi = escapeHtml(options.message);
  const platformUrl = escapeHtml(options.actionUrl);
  const homeUrl = escapeHtml(options.siteUrl.replace(/\/$/, ""));
  const unsubscribeUrl = escapeHtml(options.unsubscribeUrl);
  const safeLogoUrl = escapeHtml(getEmailLogoUrl(options.siteUrl));
  const safeLogoFallback = escapeHtml(getEmailLogoFallbackUrl(options.siteUrl));

  const isStudentPurchase = options.record.type === "mentor_package_purchased";
  const heading = isStudentPurchase
    ? "Paket satın alımınız tamamlandı 🎉"
    : "Yeni paket satışı 🔔";
  const intro = isStudentPurchase
    ? "Ödemeniz başarıyla alındı. Mentörünüzle iletişime geçebilir ve ilk görüşme zamanınızı planlayabilirsiniz."
    : "Bir danışman paketinizi satın aldı. Lütfen en kısa sürede ilk görüşmenizi planlayın.";
  const ctaLabel = isStudentPurchase ? "Danışman Paneline Git" : "Öğrencilerime Git";
  const invoiceUrl = isSafeExternalUrl(options.invoiceHostedUrl)
    ? options.invoiceHostedUrl
    : isSafeExternalUrl(options.invoicePdfUrl)
      ? options.invoicePdfUrl
      : null;
  const safeInvoiceUrl = invoiceUrl ? escapeHtml(invoiceUrl) : "";
  const invoicePdfAttached = options.invoicePdfAttached === true;
  const invoiceSection = isStudentPurchase && (invoicePdfAttached || invoiceUrl)
    ? `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td style="background-color: #052e16; border: 1px solid #166534; border-radius: 8px; padding: 16px 20px;">
                    <p style="margin: 0 0 12px 0; color: #86efac; font-size: 14px; line-height: 1.5; text-align: center;">
                      ${
    invoicePdfAttached
      ? "Ödemenize ait faturanız bu e-postanın ekinde PDF olarak gönderilmiştir."
      : "Ödemenize ait faturanız hazır. Aşağıdaki bağlantıdan görüntüleyebilir veya indirebilirsiniz."
  }
                      ${
    invoicePdfAttached && invoiceUrl
      ? " İsterseniz çevrimiçi görüntülemek için aşağıdaki bağlantıyı da kullanabilirsiniz."
      : ""
  }
                    </p>
                    ${
    invoiceUrl
      ? `<table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td align="center">
                          <a href="${safeInvoiceUrl}" target="_blank" style="display: inline-block; padding: 12px 28px; background-color: #16a34a; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px;">
                            ${invoicePdfAttached ? "Faturayı Çevrimiçi Görüntüle" : "Faturanızı Görüntüleyin"}
                          </a>
                        </td>
                      </tr>
                    </table>`
      : ""
  }
                  </td>
                </tr>
              </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>rekabetli.com — ${escapeHtml(heading)}</title>
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
                ${escapeHtml(heading)}
              </h2>
              <p style="margin: 0 0 12px 0; color: #94a3b8; font-size: 15px; line-height: 1.6; text-align: center;">
                Merhaba <strong style="color: #e2e8f0;">${kullaniciAdi}</strong>, ${escapeHtml(intro)}
              </p>

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td style="background-color: #0f172a; border: 1px solid #334155; border-left: 4px solid ${isStudentPurchase ? "#22c55e" : "#3b82f6"}; border-radius: 0 8px 8px 0; padding: 16px 20px;">
                    <p style="margin: 0; color: #cbd5e1; font-size: 15px; line-height: 1.6; text-align: center;">
                      ${bildirimIcerigi}
                    </p>
                  </td>
                </tr>
              </table>

              ${invoiceSection}

              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center" style="padding: 4px 0;">
                    <a href="${platformUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35); letter-spacing: 0.3px;">
                      ${escapeHtml(ctaLabel)}
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
              <p style="margin: 6px 0 0; color: #475569; font-size: 11px;">
                Bildirim e-postalarını kapatmak için
                <a href="${unsubscribeUrl}" target="_blank" style="color: #3b82f6; text-decoration: underline;">abonelikten çık</a>.
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

function buildEmailHtml(options: {
  recipientName: string;
  message: string;
  actionUrl: string;
  siteUrl: string;
  unsubscribeUrl: string;
}): string {
  const kullaniciAdi = escapeHtml(options.recipientName || "Kullanıcı");
  const bildirimIcerigi = escapeHtml(options.message);
  const platformUrl = escapeHtml(options.actionUrl);
  const homeUrl = escapeHtml(options.siteUrl.replace(/\/$/, ""));
  const unsubscribeUrl = escapeHtml(options.unsubscribeUrl);
  const safeLogoUrl = escapeHtml(getEmailLogoUrl(options.siteUrl));
  const safeLogoFallback = escapeHtml(getEmailLogoFallbackUrl(options.siteUrl));

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
              <p style="margin: 6px 0 0; color: #475569; font-size: 11px;">
                Bildirim e-postalarını kapatmak için
                <a href="${unsubscribeUrl}" target="_blank" style="color: #3b82f6; text-decoration: underline;">abonelikten çık</a>.
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
    .from("notification_email_queue")
    .select("id, notifications!inner(user_id)", { count: "exact", head: true })
    .eq("status", "sent")
    .eq("notifications.user_id", userId)
    .gte("processed_at", since);

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
  attachments?: ResendAttachment[];
}): Promise<void> {
  const payload: Record<string, unknown> = {
    from: FROM_EMAIL,
    to: [options.to],
    subject: options.subject,
    html: options.html,
  };

  if (options.attachments?.length) {
    payload.attachments = options.attachments;
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429) {
      const retryHeader = response.headers.get("retry-after")?.trim();
      const retryAfterSec = Math.max(
        1,
        Number.parseInt(retryHeader ?? "2", 10) || 2,
      );
      throw new ResendRateLimitError(
        retryAfterSec,
        `Resend rate limit (429): ${errorText}`,
      );
    }
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

async function fetchNotificationById(
  supabase: SupabaseClient,
  notificationId: string,
): Promise<NotificationRecord | null> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("id", notificationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Bildirim okunamadı: ${error.message}`);
  }

  return (data as NotificationRecord | null) ?? null;
}

function isDisabledEmailPref(value: unknown): boolean {
  return value === false || value === "false" || value === 0 || value === "0";
}

async function resolveNotificationCommunityId(
  supabase: SupabaseClient,
  notification: NotificationRecord,
): Promise<string | null> {
  if (isSafeUuid(notification.community_id)) {
    return notification.community_id;
  }
  if (!isSafeUuid(notification.post_id)) {
    return null;
  }

  const { data, error } = await supabase
    .from("posts")
    .select("community_id")
    .eq("id", notification.post_id)
    .maybeSingle<{ community_id: string | null }>();

  if (error) {
    throw new Error(`Topluluk kimliği okunamadı: ${error.message}`);
  }

  return isSafeUuid(data?.community_id) ? data.community_id : null;
}

async function isCommunityEmailOptedOut(
  supabase: SupabaseClient,
  notification: NotificationRecord,
): Promise<boolean> {
  if (!isSafeUuid(notification.user_id)) return false;

  const communityId = await resolveNotificationCommunityId(supabase, notification);
  if (!communityId) return false;

  const { data: rpcEnabled, error: rpcError } = await supabase.rpc(
    "is_community_email_enabled",
    {
      p_community_id: communityId,
      p_user_id: notification.user_id,
    },
  );

  if (!rpcError && typeof rpcEnabled === "boolean") {
    return rpcEnabled !== true;
  }

  const { data: memberPref, error } = await supabase
    .from("community_members")
    .select("email_notifications_enabled")
    .eq("community_id", communityId)
    .eq("user_id", notification.user_id)
    .maybeSingle<{ email_notifications_enabled: boolean | string | null }>();

  if (error) {
    throw new Error(`Topluluk e-posta tercihi okunamadı: ${error.message}`);
  }

  return isDisabledEmailPref(memberPref?.email_notifications_enabled);
}

async function enqueueNotificationIds(
  supabase: SupabaseClient,
  notificationIds: string[],
): Promise<number> {
  if (!notificationIds.length) return 0;

  const allowedIds: string[] = [];
  for (const notificationId of notificationIds) {
    const notification = await fetchNotificationById(supabase, notificationId);
    if (!notification) continue;
    if (await isCommunityEmailOptedOut(supabase, notification)) {
      console.log(
        `Kuyruğa alınmadı (community_email_opt_out): notification_id=${notificationId}`,
      );
      continue;
    }
    allowedIds.push(notificationId);
  }

  if (!allowedIds.length) return 0;

  const rows = allowedIds.map((notification_id) => ({ notification_id }));
  const { error } = await supabase
    .from("notification_email_queue")
    .upsert(rows, { onConflict: "notification_id", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Kuyruk ekleme hatası: ${error.message}`);
  }

  return allowedIds.length;
}

async function finalizeQueueItem(
  supabase: SupabaseClient,
  queueId: string,
  status: "sent" | "skipped" | "failed" | "pending",
  options?: { lastError?: string; retryAt?: string },
): Promise<void> {
  const patch: Record<string, unknown> = {
    status,
    processed_at: status === "pending" ? null : new Date().toISOString(),
  };

  if (options?.lastError !== undefined) {
    patch.last_error = options.lastError;
  }

  if (options?.retryAt) {
    patch.scheduled_at = options.retryAt;
  }

  const { error } = await supabase
    .from("notification_email_queue")
    .update(patch)
    .eq("id", queueId);

  if (error) {
    throw new Error(`Kuyruk güncellenemedi: ${error.message}`);
  }
}

type ProcessResult =
  | { ok: true; sent: true; notificationId: string; recipient: string }
  | { ok: true; skipped: true; reason: string; notificationId: string };

async function processNotificationEmail(options: {
  notification: NotificationRecord;
  resendApiKey: string;
  supabase: SupabaseClient;
  siteUrl: string;
}): Promise<ProcessResult> {
  const { notification, resendApiKey, supabase, siteUrl } = options;

  if (notification.email_sent === true) {
    console.log(`Bildirim ${notification.id} için e-posta zaten gönderilmiş, atlanıyor.`);
    return {
      ok: true,
      skipped: true,
      reason: "already_sent",
      notificationId: notification.id,
    };
  }

  console.log(
    `Bildirim işleniyor: id=${notification.id}, user_id=${notification.user_id}, type=${notification.type}`,
  );

  if (isNotificationTooOld(notification)) {
    console.log(
      `Eski bildirim e-postası atlandı: notification_id=${notification.id}, created_at=${notification.created_at}`,
    );
    return {
      ok: true,
      skipped: true,
      reason: "too_old",
      notificationId: notification.id,
    };
  }

  const recentEmailCount = await countRecentEmailsSent(supabase, notification.user_id);
  if (recentEmailCount >= RATE_LIMIT_MAX_EMAILS) {
    console.log(
      `Rate limit aşıldı: user_id=${notification.user_id}, son 1 saatte ${recentEmailCount} e-posta gönderildi.`,
    );
    return {
      ok: true,
      skipped: true,
      reason: "rate_limit",
      notificationId: notification.id,
    };
  }

  const { data: prefRow, error: prefError } = await supabase
    .from("email_preferences")
    .select("user_id, notification_emails_enabled, unsubscribe_token")
    .eq("user_id", notification.user_id)
    .maybeSingle<EmailPreferenceRow>();

  if (prefError) {
    throw new Error(`E-posta tercihleri okunamadı: ${prefError.message}`);
  }

  if (prefRow && prefRow.notification_emails_enabled === false) {
    return {
      ok: true,
      skipped: true,
      reason: "notification_opt_out",
      notificationId: notification.id,
    };
  }

  const communityOptOut = await isCommunityEmailOptedOut(supabase, notification);
  if (communityOptOut) {
    console.log(
      `Topluluk e-posta tercihi kapalı, atlandı: notification_id=${notification.id}, type=${notification.type}`,
    );
    return {
      ok: true,
      skipped: true,
      reason: "community_email_opt_out",
      notificationId: notification.id,
    };
  }

  const { email, displayName } = await getRecipientProfile(supabase, notification.user_id);
  const message = buildNotificationMessage(notification);
  const actionUrl = buildNotificationLink(notification, siteUrl);
  const unsubscribeUrl = prefRow?.unsubscribe_token
    ? `${siteUrl}/unsubscribe?token=${encodeURIComponent(prefRow.unsubscribe_token)}&type=notifications`
    : `${siteUrl}/unsubscribe?type=notifications`;
  console.log(`E-posta linkleri siteUrl=${siteUrl}, actionUrl=${actionUrl}`);

  const invoiceContext = notification.type === "mentor_package_purchased"
    ? await fetchPackageOrderInvoiceContext(supabase, notification)
    : { hostedUrl: null, pdfUrl: null, invoiceId: null, packageTitle: null };

  const invoiceAttachment = notification.type === "mentor_package_purchased"
    ? await downloadStripeInvoicePdfForEmail(invoiceContext).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("invoice pdf attachment skipped:", notification.id, message);
      return null;
    })
    : null;

  const html = isPackagePurchaseType(notification.type)
    ? buildPurchaseEmailHtml({
        recipientName: displayName,
        record: notification,
        message,
        actionUrl,
        siteUrl,
        unsubscribeUrl,
        invoiceHostedUrl: invoiceContext.hostedUrl,
        invoicePdfUrl: invoiceContext.pdfUrl,
        invoicePdfAttached: Boolean(invoiceAttachment),
      })
    : buildEmailHtml({
        recipientName: displayName,
        message,
        actionUrl,
        siteUrl,
        unsubscribeUrl,
      });

  await sendEmailViaResend({
    apiKey: resendApiKey,
    to: email,
    subject: buildEmailSubject(notification, Boolean(invoiceAttachment)),
    html,
    attachments: invoiceAttachment ? [invoiceAttachment] : undefined,
  });

  await markNotificationEmailSent(supabase, notification.id);

  console.log(
    `E-posta gönderildi: notification_id=${notification.id}, to=${email}, invoice_attachment=${
      invoiceAttachment ? invoiceAttachment.filename : "none"
    }`,
  );

  return {
    ok: true,
    sent: true,
    notificationId: notification.id,
    recipient: email,
  };
}

async function processEmailQueue(options: {
  supabase: SupabaseClient;
  resendApiKey: string;
  siteUrl: string;
  batchSize?: number;
  /** Webhook'tan çağrıldığında kilit meşgulse atla (cron devralır) */
  skipIfLocked?: boolean;
}): Promise<Record<string, unknown>> {
  const sendDelayMs = getSendDelayMs();
  const batchSize = options.batchSize ?? getQueueBatchSize();
  const { supabase, resendApiKey, siteUrl, skipIfLocked = false } = options;

  await supabase.rpc("reset_stale_notification_email_queue").then(({ error }) => {
    if (error) {
      console.warn("reset_stale_notification_email_queue:", error.message);
    }
  });

  const { data: gotLock, error: lockError } = await supabase.rpc(
    "try_notification_email_worker_lock",
  );
  if (lockError) {
    console.warn("Worker lock RPC yok veya hata (fix SQL çalıştırın):", lockError.message);
  } else if (gotLock !== true) {
    if (skipIfLocked) {
      return {
        ok: true,
        mode: "process_queue",
        skipped: true,
        reason: "worker_busy",
      };
    }
    console.log("Başka bir worker kuyruğu işliyor, atlanıyor.");
    return {
      ok: true,
      mode: "process_queue",
      skipped: true,
      reason: "worker_busy",
    };
  }

  try {
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_notification_email_queue",
      { p_limit: batchSize },
    );

    if (claimError) {
      throw new Error(`Kuyruk alınamadı: ${claimError.message}`);
    }

    const queueItems = (claimed ?? []) as QueueRow[];
    if (!queueItems.length) {
      return {
        ok: true,
        mode: "process_queue",
        claimed: 0,
        sentCount: 0,
        sendDelayMs,
        batchSize,
        resendMaxPerSecond: getResendMaxPerSecond(),
        results: [],
      };
    }

    const results: Record<string, unknown>[] = [];

    for (const item of queueItems) {
      try {
        const notification = await fetchNotificationById(supabase, item.notification_id);
        if (!notification) {
          await finalizeQueueItem(supabase, item.id, "failed", {
            lastError: "Bildirim kaydı bulunamadı.",
          });
          results.push({
            ok: false,
            queueId: item.id,
            notificationId: item.notification_id,
            error: "Bildirim kaydı bulunamadı.",
          });
          continue;
        }

        const result = await processNotificationEmail({
          notification,
          resendApiKey,
          supabase,
          siteUrl,
        });

        if ("sent" in result && result.sent) {
          await finalizeQueueItem(supabase, item.id, "sent");
          results.push({ ...result, queueId: item.id });
        } else if ("skipped" in result && result.skipped) {
          if (result.reason === "rate_limit") {
            const retryAt = new Date(Date.now() + RATE_LIMIT_RETRY_MS).toISOString();
            await finalizeQueueItem(supabase, item.id, "pending", { retryAt });
            results.push({ ...result, queueId: item.id, retryAt });
          } else {
            await finalizeQueueItem(supabase, item.id, "skipped");
            results.push({ ...result, queueId: item.id });
          }
        }
      } catch (error) {
        if (error instanceof ResendRateLimitError) {
          const retryAt = new Date(
            Date.now() + error.retryAfterSec * 1000,
          ).toISOString();
          await finalizeQueueItem(supabase, item.id, "pending", { retryAt });
          results.push({
            ok: true,
            rateLimited: true,
            queueId: item.id,
            retryAfterSec: error.retryAfterSec,
          });
          await delay(error.retryAfterSec * 1000);
          break;
        }

        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `Kuyruk öğesi işlenemedi: queue_id=${item.id}, notification_id=${item.notification_id}, hata=${message}`,
        );
        await finalizeQueueItem(supabase, item.id, "failed", { lastError: message });
        results.push({
          ok: false,
          queueId: item.id,
          notificationId: item.notification_id,
          error: message,
        });
      }

      await delay(sendDelayMs);
    }

    const sentCount = results.filter((result) => result.sent === true).length;
    const failedCount = results.filter((result) => result.ok === false).length;

    return {
      ok: failedCount === 0,
      mode: "process_queue",
      claimed: queueItems.length,
      sentCount,
      failedCount,
      sendDelayMs,
      batchSize,
      resendMaxPerSecond: getResendMaxPerSecond(),
      results,
    };
  } finally {
    const { error: unlockError } = await supabase.rpc(
      "release_notification_email_worker_lock",
    );
    if (unlockError) {
      console.warn("Worker lock bırakılamadı:", unlockError.message);
    }
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

    if (isProcessQueueRequest(body)) {
      if (!canInvokePrivilegedEmailEndpoint(req, body)) {
        return jsonResponse(
          {
            error:
              "process_queue için Authorization (service role) veya CRON_SECRET gerekli.",
          },
          401,
        );
      }

      const result = await processEmailQueue({
        supabase,
        resendApiKey,
        siteUrl,
      });
      return jsonResponse(result);
    }

    if (!canInvokePrivilegedEmailEndpoint(req, body)) {
      return jsonResponse(
        {
          error:
            "Bildirim kuyruğu için Authorization (service role) veya CRON_SECRET gerekli.",
        },
        401,
      );
    }

    const notifications = parseNotificationsFromRequest(body);
    if (!notifications.length) {
      console.error("Webhook payload geçersiz:", body);
      return jsonResponse({ error: "Bildirim kaydı payload içinde bulunamadı" }, 400);
    }

    const queued = await enqueueNotificationIds(
      supabase,
      notifications.map((notification) => notification.id),
    );

    console.log(`${notifications.length} bildirim kuyruğa alındı, kuyruk işleniyor…`);

    const processResult = await processEmailQueue({
      supabase,
      resendApiKey,
      siteUrl,
      skipIfLocked: true,
    });

    return jsonResponse({
      ok: true,
      mode: "enqueue_and_process",
      queued,
      notificationIds: notifications.map((notification) => notification.id),
      process: processResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("send-notification-email hatası:", message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
