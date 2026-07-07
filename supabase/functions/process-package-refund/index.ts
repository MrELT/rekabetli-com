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
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureAdmin(authHeader: string): Promise<void> {
  const userClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("auth_required");
  }

  const { data, error } = await userClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (error || !data) {
    throw new Error("admin_required");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "auth_required" }, 401);
    }

    await ensureAdmin(authHeader);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    const orderId = String(body.orderId || body.order_id || "").trim();
    const reason = String(body.reason || "").trim();

    if (!orderId) {
      return jsonResponse({ error: "order_id_required" }, 400);
    }

    const admin = createAdminClient();
    const { data: order, error: orderError } = await admin
      .from("package_orders")
      .select("id, status, stripe_payment_intent_id, amount_paid, stripe_fee, list_price, currency, user_id, package_title")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      return jsonResponse({ error: "package_order_not_found" }, 404);
    }

    if (order.status === "refunded") {
      return jsonResponse({ orderId, status: "refunded", already_refunded: true });
    }

    if (order.status !== "paid") {
      return jsonResponse({ error: "package_order_not_refundable" }, 409);
    }

    if (!order.stripe_payment_intent_id) {
      return jsonResponse({ error: "missing_payment_intent" }, 409);
    }

    const { data: refundQuote, error: quoteError } = await admin.rpc("get_package_refund_amounts", {
      p_order_id: orderId,
    });

    if (quoteError || !refundQuote) {
      console.error("get_package_refund_amounts:", quoteError?.message);
      return jsonResponse({ error: "refund_quote_failed" }, 500);
    }

    const refundAmount = Number(refundQuote.refund_amount);
    const stripeFeeRetained = Number(refundQuote.stripe_fee_retained);

    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      return jsonResponse({ error: "invalid_refund_amount" }, 409);
    }

    const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: order.stripe_payment_intent_id,
      metadata: { order_id: orderId },
    };

    const currency = String(order.currency || refundQuote.currency || "try").toLowerCase();
    const zeroDecimalCurrencies = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
    const stripeAmount = zeroDecimalCurrencies.has(currency)
      ? Math.round(refundAmount)
      : Math.round(refundAmount * 100);

    refundParams.amount = stripeAmount;

    const refund = await stripe.refunds.create(refundParams);

    const { data, error } = await admin.rpc("complete_package_refund", {
      p_order_id: orderId,
      p_stripe_refund_id: refund.id,
      p_refund_reason: reason,
      p_refund_amount: refundAmount,
      p_stripe_fee_retained: stripeFeeRetained,
    });

    if (error) {
      console.error("complete_package_refund:", error.message);
      return jsonResponse(
        {
          error: "refund_record_failed",
          message: error.message,
          stripe_refund_id: refund.id,
        },
        500,
      );
    }

    return jsonResponse({
      orderId,
      status: "refunded",
      stripe_refund_id: refund.id,
      refund_amount: refundAmount,
      stripe_fee_retained: stripeFeeRetained,
      result: data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "auth_required") return jsonResponse({ error: "auth_required" }, 401);
    if (message === "admin_required") return jsonResponse({ error: "admin_required" }, 403);
    if (message.startsWith("missing_env:")) {
      return jsonResponse({ error: "server_misconfigured", message }, 500);
    }
    console.error("process-package-refund:", message);
    return jsonResponse({ error: "internal_error", message }, 500);
  }
});
