import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  createTryPayoutQuote,
  isWiseMockEnabled,
  requireEnv,
  wiseRequest,
} from "../_shared/wise.ts";

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

function createServiceClient() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveCaller(
  authHeader: string,
): Promise<{ userId: string; isAdmin: boolean }> {
  const userClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("auth_required");
  }

  const { data: adminData } = await userClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  return { userId: authData.user.id, isAdmin: Boolean(adminData) };
}

async function ensureRecipient(
  admin: ReturnType<typeof createServiceClient>,
  details: Record<string, unknown>,
  profileId: number,
): Promise<number> {
  const influencerId = String(details.influencer_id);
  const iban = String(details.iban || "");
  const accountHolder = String(details.account_holder || "");
  const storedRecipientId = Number(details.wise_recipient_id) || 0;
  const storedIban = String(details.wise_recipient_iban || "");

  if (storedRecipientId > 0 && storedIban === iban) {
    return storedRecipientId;
  }

  const recipient = await wiseRequest("POST", "/v1/accounts", {
    currency: "TRY",
    type: "iban",
    profile: profileId,
    accountHolderName: accountHolder,
    ownedByCustomer: false,
    details: {
      legalType: "PRIVATE",
      iban,
    },
  });

  const recipientId = Number(recipient.id);
  if (!recipientId) {
    throw new Error("wise_recipient_invalid");
  }

  const { error } = await admin.rpc("save_influencer_wise_recipient", {
    p_influencer_id: influencerId,
    p_wise_recipient_id: recipientId,
    p_iban: iban,
  });

  if (error) {
    throw new Error(`save_influencer_wise_recipient:${error.message}`);
  }

  return recipientId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const admin = createServiceClient();
  let requestId = "";

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "auth_required" }, 401);
    }

    const caller = await resolveCaller(authHeader);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    requestId = String(body.requestId || body.request_id || "").trim();
    if (!requestId) {
      return jsonResponse({ error: "request_id_required" }, 400);
    }

    const { data: transferDetails, error: detailsError } = await admin.rpc(
      "get_influencer_payout_transfer_details",
      { p_request_id: requestId },
    );

    if (detailsError || !transferDetails) {
      return jsonResponse({ error: "payout_request_not_found" }, 404);
    }

    const status = String(transferDetails.status);

    if (!caller.isAdmin) {
      return jsonResponse({ error: "forbidden" }, 403);
    }

    if (!["pending", "processing"].includes(status)) {
      return jsonResponse({ error: "payout_request_not_processable", status }, 409);
    }

    const { error: beginError } = await admin.rpc("begin_influencer_payout_processing", {
      p_request_id: requestId,
    });

    if (beginError) {
      return jsonResponse({ error: "payout_begin_failed", message: beginError.message }, 409);
    }

    const profileId = Number(requireEnv("WISE_PROFILE_ID"));
    const targetAmount = Number(transferDetails.amount_net);

    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      await admin.rpc("fail_influencer_payout", {
        p_request_id: requestId,
        p_reason: "Geçersiz ödeme tutarı.",
      });
      return jsonResponse({ error: "invalid_amount" }, 400);
    }

    if (isWiseMockEnabled()) {
      const transferId = Date.now();
      const { data: completed, error: completeError } = await admin.rpc("complete_influencer_payout", {
        p_request_id: requestId,
        p_wise_transfer_id: transferId,
      });

      if (completeError) {
        return jsonResponse({ error: "payout_complete_failed", message: completeError.message }, 500);
      }

      return jsonResponse({
        request_id: requestId,
        status: "completed",
        wise_transfer_id: transferId,
        mock: true,
        result: completed,
      });
    }

    const recipientId = await ensureRecipient(admin, transferDetails as Record<string, unknown>, profileId);

    let quoteUuid = String(transferDetails.wise_quote_id || "").trim();
    if (!quoteUuid) {
      const quote = await createTryPayoutQuote(profileId, targetAmount);
      quoteUuid = String(quote.id || "");
      if (!quoteUuid) {
        throw new Error("wise_quote_invalid");
      }
    }

    const transfer = await wiseRequest("POST", "/v1/transfers", {
      targetAccount: recipientId,
      quoteUuid,
      customerTransactionId: requestId,
      details: {
        reference: "rekabetli influencer odeme",
      },
    });

    const transferId = Number(transfer.id);
    if (!transferId) {
      throw new Error("wise_transfer_invalid");
    }

    await wiseRequest("POST", `/v3/profiles/${profileId}/transfers/${transferId}/payments`, {
      type: "BALANCE",
    });

    const { data: completed, error: completeError } = await admin.rpc("complete_influencer_payout", {
      p_request_id: requestId,
      p_wise_transfer_id: transferId,
    });

    if (completeError) {
      return jsonResponse({ error: "payout_complete_failed", message: completeError.message }, 500);
    }

    return jsonResponse({
      request_id: requestId,
      status: "completed",
      wise_transfer_id: transferId,
      wise_quote_id: quoteUuid,
      result: completed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    try {
      if (requestId) {
        await admin.rpc("fail_influencer_payout", {
          p_request_id: requestId,
          p_reason: message.slice(0, 500),
        });
      }
    } catch {
      // ignore secondary failure
    }

    if (message === "auth_required") return jsonResponse({ error: "auth_required" }, 401);
    if (message.startsWith("missing_env:")) {
      return jsonResponse({ error: "server_misconfigured", message }, 500);
    }
    if (message.startsWith("wise_api:")) {
      return jsonResponse({ error: "wise_api_failed", message: message.slice(9) }, 502);
    }

    console.error("process-influencer-payout:", message);
    return jsonResponse({ error: "internal_error", message }, 500);
  }
});
