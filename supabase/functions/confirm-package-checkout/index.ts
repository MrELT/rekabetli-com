import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

function createAdminClient() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isPaidStripeSession(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === "paid" || session.status === "complete";
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
    if (stripeSecretKey.startsWith("pk_") || !stripeSecretKey.startsWith("sk_")) {
      return jsonResponse({ error: "server_misconfigured" }, 500);
    }

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const supabaseAnonKey = requireEnv("SUPABASE_ANON_KEY");
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

    const sessionId = String(body.sessionId || body.session_id || "").trim();
    if (!sessionId || sessionId.length > 255) {
      return jsonResponse({ error: "invalid_session" }, 400);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user?.id) {
      return jsonResponse({ error: "auth_required", message: "Giriş gerekli." }, 401);
    }

    const { data: orderData, error: orderError } = await userClient.rpc(
      "get_my_package_order_by_checkout_session",
      { p_stripe_checkout_session_id: sessionId },
    );

    if (orderError) {
      console.error("get_my_package_order_by_checkout_session:", orderError.message);
      return jsonResponse({
        ok: false,
        status: "pending",
        error: "order_lookup_failed",
        message: "Sipariş durumu şu anda doğrulanamadı. Lütfen tekrar deneyin.",
      });
    }

    if (!orderData) {
      return jsonResponse({
        ok: false,
        status: "pending",
        error: "order_not_found",
        message: "Sipariş henüz sisteme yansımadı. Lütfen biraz sonra tekrar deneyin.",
      });
    }

    const orderId = String(orderData.order_id || "");
    const status = String(orderData.status || "");
    const enrollmentId = orderData.enrollment_id ? String(orderData.enrollment_id) : "";

    if (status === "paid" && enrollmentId) {
      return jsonResponse({
        ok: true,
        status,
        enrollment_id: enrollmentId,
        already_completed: true,
      });
    }

    const stripe = new Stripe(stripeSecretKey);
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (stripeError) {
      const message = stripeError instanceof Error ? stripeError.message : String(stripeError);
      console.error("stripe checkout retrieve:", message);
      return jsonResponse({
        ok: false,
        status: "pending",
        error: "stripe_lookup_failed",
        message: "Ödeme oturumu doğrulanamadı. Lütfen biraz sonra tekrar deneyin.",
      });
    }

    const sessionOrderId =
      session.metadata?.order_id?.trim() || session.client_reference_id?.trim() || "";

    if (!sessionOrderId || sessionOrderId !== orderId) {
      return jsonResponse({
        ok: false,
        status: "pending",
        error: "session_order_mismatch",
        message: "Ödeme oturumu kontrol ediliyor. Lütfen kısa süre sonra tekrar deneyin.",
      });
    }

    const sessionUserId = session.metadata?.user_id?.trim() || "";
    if (sessionUserId && sessionUserId !== user.id) {
      return jsonResponse({
        ok: false,
        status: "pending",
        error: "session_user_mismatch",
        message: "Ödeme oturumu kontrol ediliyor. Lütfen kısa süre sonra tekrar deneyin.",
      });
    }

    if (!isPaidStripeSession(session)) {
      return jsonResponse({
        ok: false,
        status: "pending",
        message: "Ödeme henüz onaylanmadı.",
      });
    }

    const amountPaid =
      session.amount_total != null && session.currency?.toLowerCase() === "try"
        ? session.amount_total / 100
        : null;

    const admin = createAdminClient();
    const { data: purchaseData, error: purchaseError } = await admin.rpc(
      "complete_package_purchase",
      {
        p_order_id: orderId,
        p_stripe_checkout_session_id: session.id,
        p_stripe_payment_intent_id:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        p_amount_paid: amountPaid,
      },
    );

    if (purchaseError) {
      console.error("complete_package_purchase:", purchaseError.message);
      return jsonResponse({
        ok: false,
        status: "pending",
        error: "purchase_complete_failed",
        message: "Ödeme alındı, kayıt tamamlanıyor. Lütfen 1 dakika sonra tekrar deneyin.",
      });
    }

    const { data: refreshedOrder, error: refreshError } = await userClient.rpc(
      "get_my_package_order_by_checkout_session",
      { p_stripe_checkout_session_id: sessionId },
    );

    if (refreshError) {
      console.error("refresh order:", refreshError.message);
    }

    return jsonResponse({
      ok: true,
      status: String(refreshedOrder?.status || purchaseData?.status || "paid"),
      enrollment_id: refreshedOrder?.enrollment_id || purchaseData?.enrollment_id || null,
      repaired: Boolean(purchaseData?.repaired),
      already_completed: Boolean(purchaseData?.already_completed),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("confirm-package-checkout:", message);
    if (message.startsWith("missing_env:")) {
      return jsonResponse({
        ok: false,
        status: "pending",
        error: "server_misconfigured",
        message: "Sunucu yapılandırması kontrol ediliyor. Lütfen biraz sonra tekrar deneyin.",
      });
    }
    return jsonResponse({
      ok: false,
      status: "pending",
      error: "internal_error",
      message: "Ödeme onayı gecikti. Lütfen biraz sonra tekrar deneyin.",
    });
  }
});
