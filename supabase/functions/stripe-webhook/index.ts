import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const cryptoProvider = Stripe.createSubtleCryptoProvider();

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

async function triggerNotificationEmailQueue(): Promise<void> {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "process_queue" }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn("send-notification-email queue trigger failed:", response.status, text);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("send-notification-email queue trigger error:", message);
  }
}

function extractStripeInvoice(
  invoice: Stripe.Invoice | string | null | undefined,
): { id: string; hostedUrl: string | null; pdfUrl: string | null } | null {
  if (!invoice) return null;

  if (typeof invoice === "string") {
    return { id: invoice, hostedUrl: null, pdfUrl: null };
  }

  const id = invoice.id?.trim();
  if (!id) return null;

  return {
    id,
    hostedUrl: invoice.hosted_invoice_url?.trim() || null,
    pdfUrl: invoice.invoice_pdf?.trim() || null,
  };
}

async function attachStripeInvoiceToOrder(
  admin: ReturnType<typeof createAdminClient>,
  stripe: Stripe,
  orderId: string,
  session: Stripe.Checkout.Session,
): Promise<{ notificationCreated: boolean }> {
  let invoiceRef = session.invoice;

  if (!invoiceRef) {
    try {
      const expanded = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["invoice"],
      });
      invoiceRef = expanded.invoice;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("stripe invoice session retrieve failed:", orderId, message);
    }
  }

  let invoiceMeta = extractStripeInvoice(invoiceRef);

  if (invoiceMeta?.id && (!invoiceMeta.hostedUrl || !invoiceMeta.pdfUrl)) {
    try {
      const invoice = await stripe.invoices.retrieve(invoiceMeta.id);
      invoiceMeta = extractStripeInvoice(invoice) ?? invoiceMeta;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("stripe invoice retrieve failed:", orderId, invoiceMeta.id, message);
    }
  }

  const { data, error } = await admin.rpc("finalize_package_order_stripe_invoice", {
    p_order_id: orderId,
    p_stripe_invoice_id: invoiceMeta?.id ?? null,
    p_hosted_invoice_url: invoiceMeta?.hostedUrl ?? null,
    p_invoice_pdf_url: invoiceMeta?.pdfUrl ?? null,
  });

  if (error) {
    throw new Error(`finalize_package_order_stripe_invoice:${error.message}`);
  }

  const alreadyNotified = data?.already_notified === true;
  const notificationCreated = data?.already_notified === false && Boolean(data?.notification_id);

  console.log("package purchase student notification:", orderId, invoiceMeta?.id ?? "no_invoice", data);

  if (!alreadyNotified && data?.skipped_notification) {
    console.warn("student purchase notification skipped:", orderId, data);
  }

  return { notificationCreated };
}

async function handleCheckoutCompleted(
  admin: ReturnType<typeof createAdminClient>,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const orderId =
    session.metadata?.order_id?.trim() ||
    session.client_reference_id?.trim() ||
    "";

  if (!orderId) {
    throw new Error("missing_order_id_in_session");
  }

  const amountPaid =
    session.amount_total != null && session.currency?.toLowerCase() === "try"
      ? session.amount_total / 100
      : null;

  const { data, error } = await admin.rpc("complete_package_purchase", {
    p_order_id: orderId,
    p_stripe_checkout_session_id: session.id,
    p_stripe_payment_intent_id:
      typeof session.payment_intent === "string" ? session.payment_intent : null,
    p_amount_paid: amountPaid,
  });

  if (error) {
    const message = error.message || "";
    if (
      message.includes("package_order_not_pending") ||
      message.includes("package_order_session_mismatch")
    ) {
      const { data: order } = await admin
        .from("package_orders")
        .select("status")
        .eq("id", orderId)
        .maybeSingle();

      if (order?.status === "paid") {
        console.log("checkout already finalized:", orderId);
        await attachStripeInvoiceToOrder(admin, stripe, orderId, session);
        await triggerNotificationEmailQueue();
        return;
      }
    }

    throw new Error(`complete_package_purchase:${message}`);
  }

  console.log("checkout completed:", orderId, data);
  await attachStripeInvoiceToOrder(admin, stripe, orderId, session);
  await triggerNotificationEmailQueue();
}

async function handleCheckoutExpired(
  admin: ReturnType<typeof createAdminClient>,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const { error } = await admin.rpc("expire_package_order_by_session", {
    p_stripe_checkout_session_id: session.id,
  });

  if (error) {
    throw new Error(`expire_package_order_by_session:${error.message}`);
  }

  console.log("checkout expired:", session.id);
}

async function completeRefundForPaymentIntent(
  admin: ReturnType<typeof createAdminClient>,
  paymentIntentId: string,
  stripeRefundId: string,
  stripeRefundAmountMinor?: number,
): Promise<void> {
  const { data: order } = await admin
    .from("package_orders")
    .select("id, status")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (!order?.id || order.status === "refunded") {
    return;
  }

  const { data: refundQuote, error: quoteError } = await admin.rpc("get_package_refund_amounts", {
    p_order_id: order.id,
  });

  if (quoteError || !refundQuote) {
    throw new Error(`get_package_refund_amounts:${quoteError?.message || "missing_quote"}`);
  }

  let refundAmount = Number(refundQuote.refund_amount);
  let stripeFeeRetained = Number(refundQuote.stripe_fee_retained);

  if (Number.isFinite(stripeRefundAmountMinor) && stripeRefundAmountMinor > 0) {
    const currency = String(refundQuote.currency || "try").toLowerCase();
    const zeroDecimalCurrencies = new Set([
      "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
    ]);
    refundAmount = zeroDecimalCurrencies.has(currency)
      ? stripeRefundAmountMinor
      : stripeRefundAmountMinor / 100;
    stripeFeeRetained = Math.max(Number(refundQuote.amount_paid) - refundAmount, 0);
  }

  const { error } = await admin.rpc("complete_package_refund", {
    p_order_id: order.id,
    p_stripe_refund_id: stripeRefundId,
    p_refund_reason: "Stripe iadesi",
    p_refund_amount: refundAmount,
    p_stripe_fee_retained: stripeFeeRetained,
  });

  if (error) {
    throw new Error(`complete_package_refund:${error.message}`);
  }

  console.log("refund completed:", order.id, stripeRefundId);
}

async function handleRefundUpdated(
  admin: ReturnType<typeof createAdminClient>,
  refund: Stripe.Refund,
): Promise<void> {
  const paymentIntentId =
    typeof refund.payment_intent === "string" ? refund.payment_intent : null;

  if (!paymentIntentId || refund.status !== "succeeded") {
    return;
  }

  await completeRefundForPaymentIntent(admin, paymentIntentId, refund.id, refund.amount ?? undefined);
}

async function handleChargeRefunded(
  admin: ReturnType<typeof createAdminClient>,
  charge: Stripe.Charge,
): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : null;

  if (!paymentIntentId || !charge.refunded) {
    return;
  }

  const refundId =
    charge.refunds?.data?.find((row) => row.status === "succeeded")?.id ||
    charge.id;
  const refundAmountMinor =
    charge.refunds?.data?.find((row) => row.status === "succeeded")?.amount ??
    charge.amount_refunded ??
    undefined;

  await completeRefundForPaymentIntent(admin, paymentIntentId, refundId, refundAmountMinor);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const stripeSecretKey = requireEnv("STRIPE_SECRET_KEY");
  if (stripeSecretKey.startsWith("pk_") || !stripeSecretKey.startsWith("sk_")) {
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }
  const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");
  const stripe = new Stripe(stripeSecretKey);

  const signature = req.headers.get("stripe-signature") || req.headers.get("Stripe-Signature");
  if (!signature) {
    console.error("stripe webhook: missing Stripe-Signature header");
    return jsonResponse({ error: "missing_signature" }, 400);
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      "stripe webhook signature failed:",
      message,
      "hint=STRIPE_WEBHOOK_SECRET must match the signing secret of THIS webhook endpoint in Stripe Dashboard (test vs live).",
    );
    return jsonResponse({ error: "invalid_signature" }, 400);
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status === "paid" || session.status === "complete") {
          await handleCheckoutCompleted(admin, stripe, session);
        }
        break;
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutExpired(admin, session);
        break;
      }
      case "refund.updated": {
        const refund = event.data.object as Stripe.Refund;
        await handleRefundUpdated(admin, refund);
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        await handleChargeRefunded(admin, charge);
        break;
      }
      default:
        console.log("ignored stripe event:", event.type);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("stripe webhook handler:", message);
    return jsonResponse({ error: "handler_failed", message }, 500);
  }

  return jsonResponse({ received: true });
});
