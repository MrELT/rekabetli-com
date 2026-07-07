import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  computePayoutSplit,
  isWiseMockEnabled,
  requireEnv,
  roundMoney,
} from "../_shared/wise.ts";
import { assertApiRateLimit } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAYOUT_MIN_AMOUNT_TRY = 500;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseRequestedAmount(body: Record<string, unknown>): number | null {
  const raw = body.amount ?? body.p_amount;
  if (raw == null || raw === "") return null;
  const amount = roundMoney(Number(raw));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
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

    const userClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return jsonResponse({ error: "auth_required" }, 401);
    }

    const adminClient = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    try {
      await assertApiRateLimit(adminClient, `influencer_payout:${authData.user.id}`, 5, 3600);
    } catch (rateError) {
      const message = rateError instanceof Error ? rateError.message : String(rateError);
      if (message === "rate_limit_exceeded") {
        return jsonResponse({ error: "rate_limit_exceeded", message: "Çok fazla ödeme talebi. Lütfen daha sonra tekrar deneyin." }, 429);
      }
      throw rateError;
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const requestedAmount = parseRequestedAmount(body);
    if (requestedAmount == null) {
      return jsonResponse({ error: "payout_amount_invalid" }, 400);
    }

    const { data: summary, error: balanceError } = await userClient.rpc("get_influencer_wallet_summary");
    if (balanceError) {
      return jsonResponse({ error: "balance_lookup_failed", message: balanceError.message }, 500);
    }

    const availableBalance = Number(summary?.available_balance) || 0;
    const minAmount = Number(summary?.payout_min_amount) || PAYOUT_MIN_AMOUNT_TRY;

    if (availableBalance <= 0) {
      return jsonResponse({ error: "payout_insufficient_balance" }, 400);
    }

    if (requestedAmount < minAmount) {
      return jsonResponse({
        error: "payout_amount_below_minimum",
        min_amount: minAmount,
      }, 400);
    }

    if (requestedAmount > availableBalance) {
      return jsonResponse({ error: "payout_insufficient_balance" }, 400);
    }

    const profileId = Number(requireEnv("WISE_PROFILE_ID"));
    const split = await computePayoutSplit(profileId, requestedAmount);

    const { data, error } = await adminClient.rpc("request_influencer_payout", {
      p_influencer_id: authData.user.id,
      p_amount: split.amountRequested,
      p_transfer_fee: split.transferFeeTry,
      p_wise_quote_id: split.quoteId,
    });

    if (error) {
      return jsonResponse({ error: "payout_request_failed", message: error.message }, 400);
    }

    return jsonResponse({
      request_id: data?.request_id,
      amount_requested: roundMoney(split.amountRequested),
      transfer_fee: split.transferFeeTry,
      amount_net: split.amountNet,
      status: data?.status || "pending",
      payout_fee_source: isWiseMockEnabled() ? "mock" : "wise",
      wise_quote_id: split.quoteId,
      min_amount: minAmount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("missing_env:")) {
      return jsonResponse({ error: "server_misconfigured", message }, 500);
    }
    if (message.startsWith("wise_api:")) {
      return jsonResponse({ error: "wise_api_failed", message: message.slice(9) }, 502);
    }
    console.error("create-influencer-payout:", message);
    return jsonResponse({ error: "internal_error", message }, 500);
  }
});
