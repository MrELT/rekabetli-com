import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { assertApiRateLimit } from "../_shared/rate-limit.ts";

const DEFAULT_SITE_URL = "https://rekabetli.com";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PACKAGE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateOrderResult {
  order_id: string;
  mentor_id: string;
  mentor_name: string;
  package_id: string;
  package_title: string;
  list_price: number;
  referral_credit_applied?: number;
  amount_due?: number;
  currency: string;
  amount_minor: number;
  expires_at: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

function getSiteUrl(req: Request): string {
  const origin = req.headers.get("origin")?.trim() || "";
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return origin.replace(/\/$/, "");
  }
  const siteUrl = Deno.env.get("SITE_URL")?.trim() || DEFAULT_SITE_URL;
  return siteUrl.replace(/\/$/, "");
}

function mapRpcError(message: string): { code: string; message: string; status: number } {
  const raw = message || "unknown_error";
  const map: Record<string, { message: string; status: number }> = {
    auth_required: { message: "Ödeme için giriş yapmalısınız.", status: 401 },
    package_order_self_not_allowed: {
      message: "Kendi paketinizi satın alamazsınız.",
      status: 400,
    },
    package_order_invalid_package: { message: "Geçersiz paket.", status: 400 },
    package_order_invalid_mentor: { message: "Geçersiz mentör.", status: 400 },
    package_order_mentor_unavailable: {
      message: "Bu mentör şu anda yeni öğrenci kabul etmiyor.",
      status: 409,
    },
    package_order_package_not_found: { message: "Paket bulunamadı.", status: 404 },
    package_order_already_purchased: {
      message: "Bu paketi zaten satın aldınız.",
      status: 409,
    },
    package_order_already_enrolled: {
      message: "Bu pakete zaten kayıtlısınız.",
      status: 409,
    },
    package_order_capacity_full: { message: "Paket kapasitesi doldu.", status: 409 },
  };

  for (const [code, value] of Object.entries(map)) {
    if (raw.includes(code)) {
      return { code, ...value };
    }
  }

  return { code: "package_order_failed", message: "Sipariş oluşturulamadı.", status: 500 };
}

async function createStripeCheckoutSession(input: {
  stripeSecretKey: string;
  order: CreateOrderResult;
  userId: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  invoiceEnabled?: boolean;
}): Promise<{ id: string; url: string; expires_at: number }> {
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("client_reference_id", input.order.order_id);
  params.set("metadata[order_id]", input.order.order_id);
  params.set("metadata[mentor_id]", input.order.mentor_id);
  params.set("metadata[package_id]", input.order.package_id);
  params.set("metadata[user_id]", input.userId);
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);

  if (input.invoiceEnabled) {
    params.set("customer_creation", "always");
    params.set("invoice_creation[enabled]", "true");
  }

  const customerEmail = input.customerEmail?.trim();
  if (customerEmail) {
    params.set("customer_email", customerEmail);
  }

  const expiresAtUnix = Math.floor(new Date(input.order.expires_at).getTime() / 1000);
  if (Number.isFinite(expiresAtUnix) && expiresAtUnix > Math.floor(Date.now() / 1000) + 60) {
    params.set("expires_at", String(expiresAtUnix));
  }

  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", input.order.currency || "try");
  params.set("line_items[0][price_data][unit_amount]", String(input.order.amount_minor));
  const creditApplied = Number(
    (input.order as CreateOrderResult & { referral_credit_applied?: number }).referral_credit_applied,
  );
  const productName =
    Number.isFinite(creditApplied) && creditApplied > 0
      ? `${input.order.package_title.slice(0, 90)} (${creditApplied.toFixed(2)} TRY davet indirimi)`
      : input.order.package_title.slice(0, 120);
  params.set(
    "line_items[0][price_data][product_data][name]",
    productName,
  );

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const payload = await response.json();
  if (!response.ok) {
    const stripeMessage =
      typeof payload?.error?.message === "string" ? payload.error.message : "stripe_error";
    throw new Error(`stripe_checkout_failed:${stripeMessage}`);
  }

  if (typeof payload?.id !== "string" || typeof payload?.url !== "string") {
    throw new Error("stripe_checkout_invalid_response");
  }

  return {
    id: payload.id,
    url: payload.url,
    expires_at: Number(payload.expires_at) || expiresAtUnix,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const stripeSecretKey = requireEnv("STRIPE_SECRET_KEY");
    if (stripeSecretKey.startsWith("pk_")) {
      return jsonResponse(
        {
          error: "server_misconfigured",
          message:
            "STRIPE_SECRET_KEY yanlış: publishable key (pk_) değil, secret key (sk_) kullanın.",
        },
        500,
      );
    }
    if (!stripeSecretKey.startsWith("sk_")) {
      return jsonResponse(
        {
          error: "server_misconfigured",
          message: "STRIPE_SECRET_KEY geçersiz. Stripe secret key (sk_test_ veya sk_live_) olmalı.",
        },
        500,
      );
    }

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const supabaseAnonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "auth_required", message: "Giriş gerekli." }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    const mentorId = String(body.mentorId || body.mentor_id || "").trim();
    const packageId = String(body.packageId || body.package_id || "").trim();

    if (!UUID_RE.test(mentorId)) {
      return jsonResponse({ error: "invalid_mentor" }, 400);
    }
    if (!PACKAGE_ID_RE.test(packageId)) {
      return jsonResponse({ error: "invalid_package" }, 400);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return jsonResponse({ error: "auth_required", message: "Giriş gerekli." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    try {
      await assertApiRateLimit(adminClient, `checkout:${authData.user.id}`, 15, 3600);
    } catch (rateError) {
      const message = rateError instanceof Error ? rateError.message : String(rateError);
      if (message === "rate_limit_exceeded") {
        return jsonResponse({ error: "rate_limit_exceeded", message: "Çok fazla deneme. Lütfen bir süre sonra tekrar deneyin." }, 429);
      }
      throw rateError;
    }

    const { data: orderData, error: orderError } = await userClient.rpc("create_package_order", {
      p_mentor_id: mentorId,
      p_package_id: packageId,
    });

    if (orderError) {
      const mapped = mapRpcError(orderError.message);
      return jsonResponse({ error: mapped.code, message: mapped.message }, mapped.status);
    }

    const order = orderData as CreateOrderResult;
    if (!order?.order_id || !order.amount_minor) {
      return jsonResponse({ error: "invalid_order_response" }, 500);
    }

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user?.id) {
      return jsonResponse({ error: "auth_required", message: "Giriş gerekli." }, 401);
    }

    const siteUrl = getSiteUrl(req);
    const checkoutInput = {
      stripeSecretKey,
      order,
      userId: user.id,
      customerEmail: user.email,
      successUrl: `${siteUrl}/odeme/basarili?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${siteUrl}/mentor?id=${encodeURIComponent(mentorId)}`,
    };

    let session: { id: string; url: string; expires_at: number };
    try {
      session = await createStripeCheckoutSession({ ...checkoutInput, invoiceEnabled: true });
    } catch (invoiceError) {
      const invoiceMessage =
        invoiceError instanceof Error ? invoiceError.message : String(invoiceError);
      if (!invoiceMessage.startsWith("stripe_checkout_failed:")) {
        throw invoiceError;
      }
      console.warn(
        "create-package-checkout: invoice_creation failed, retrying without invoice:",
        invoiceMessage,
      );
      session = await createStripeCheckoutSession({ ...checkoutInput, invoiceEnabled: false });
    }

    const sessionExpiresAt = Number.isFinite(session.expires_at)
      ? new Date(session.expires_at * 1000).toISOString()
      : order.expires_at;

    const { error: attachError } = await adminClient.rpc("set_package_order_checkout_session", {
      p_order_id: order.order_id,
      p_stripe_checkout_session_id: session.id,
      p_expires_at: sessionExpiresAt,
    });

    if (attachError) {
      console.error("set_package_order_checkout_session:", attachError.message);
      return jsonResponse({ error: "session_attach_failed" }, 500);
    }

    return jsonResponse({
      checkoutUrl: session.url,
      orderId: order.order_id,
      sessionId: session.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("create-package-checkout:", message);
    if (message.startsWith("stripe_checkout_failed:")) {
      const detail = message.slice("stripe_checkout_failed:".length).trim();
      return jsonResponse(
        {
          error: "stripe_checkout_failed",
          message: detail || "Stripe ödeme oturumu oluşturulamadı.",
        },
        502,
      );
    }
    if (message.startsWith("missing_env:")) {
      const envName = message.slice("missing_env:".length).trim();
      return jsonResponse(
        {
          error: "server_misconfigured",
          message: `Sunucu yapılandırması eksik: ${envName}`,
        },
        500,
      );
    }
    return jsonResponse({ error: "internal_error", message: "Beklenmeyen sunucu hatası." }, 500);
  }
});
