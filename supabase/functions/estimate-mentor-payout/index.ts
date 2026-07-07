import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  computePayoutSplit,
  isWiseMockEnabled,
  requireEnv,
  roundMoney,
} from "../_shared/wise.ts";

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

function parseRequestedAmount(body: Record<string, unknown>, availableBalance: number): number | null {
  const raw = body.amount ?? body.p_amount;
  if (raw == null || raw === "") {
    return availableBalance > 0 ? roundMoney(availableBalance) : null;
  }
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

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { data: summary, error: balanceError } = await userClient.rpc("get_mentor_wallet_summary");
    if (balanceError) {
      return jsonResponse({ error: "balance_lookup_failed", message: balanceError.message }, 500);
    }

    const availableBalance = Number(summary?.available_balance) || 0;
    const minAmount = Number(summary?.payout_min_amount) || PAYOUT_MIN_AMOUNT_TRY;

    if (availableBalance <= 0) {
      return jsonResponse({
        available_balance: 0,
        min_amount: minAmount,
        transfer_fee: 0,
        amount_net: 0,
        payout_fee_source: "wise",
      });
    }

    const requestedAmount = parseRequestedAmount(body, availableBalance);
    if (requestedAmount == null) {
      return jsonResponse({ error: "payout_amount_invalid", min_amount: minAmount }, 400);
    }

    if (requestedAmount < minAmount) {
      return jsonResponse({
        error: "payout_amount_below_minimum",
        min_amount: minAmount,
        amount_requested: requestedAmount,
      }, 400);
    }

    if (requestedAmount > availableBalance) {
      return jsonResponse({
        error: "payout_insufficient_balance",
        available_balance: availableBalance,
        amount_requested: requestedAmount,
      }, 400);
    }

    const profileId = Number(requireEnv("WISE_PROFILE_ID"));
    const split = await computePayoutSplit(profileId, requestedAmount);

    return jsonResponse({
      amount_requested: split.amountRequested,
      available_balance: availableBalance,
      min_amount: minAmount,
      transfer_fee: split.transferFeeTry,
      amount_net: split.amountNet,
      payout_fee_source: isWiseMockEnabled() ? "mock" : "wise",
      wise_quote_id: split.quoteId,
      quote_expires_at: split.quoteExpiresAt,
      source_currency: (Deno.env.get("WISE_SOURCE_CURRENCY") || "GBP").toUpperCase(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("missing_env:")) {
      return jsonResponse({ error: "server_misconfigured", message }, 500);
    }
    if (message.startsWith("wise_api:")) {
      return jsonResponse({ error: "wise_api_failed", message: message.slice(9) }, 502);
    }
    if (message === "payout_amount_too_low_after_fee") {
      return jsonResponse({ error: "payout_amount_too_low_after_fee" }, 400);
    }
    console.error("estimate-mentor-payout:", message);
    return jsonResponse({ error: "internal_error", message }, 500);
  }
});
