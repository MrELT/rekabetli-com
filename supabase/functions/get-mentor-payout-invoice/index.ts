import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { issueSelfBilledInvoiceForPayout } from "../_shared/self-billing-invoice.ts";
import { requireEnv } from "../_shared/wise.ts";

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

    const caller = await resolveCaller(authHeader);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    const requestId = String(body.requestId || body.request_id || "").trim();
    if (!requestId) {
      return jsonResponse({ error: "request_id_required" }, 400);
    }

    const admin = createServiceClient();
    const { data: payoutRow, error: payoutError } = await admin
      .from("mentor_payout_requests")
      .select("id, mentor_id, status, self_billed_invoice_path, invoice_number")
      .eq("id", requestId)
      .maybeSingle();

    if (payoutError || !payoutRow) {
      return jsonResponse({ error: "payout_request_not_found" }, 404);
    }

    if (!caller.isAdmin && caller.userId !== payoutRow.mentor_id) {
      return jsonResponse({ error: "forbidden" }, 403);
    }

    if (payoutRow.status !== "completed") {
      return jsonResponse({ error: "payout_not_completed" }, 409);
    }

    let storagePath = payoutRow.self_billed_invoice_path as string | null;
    let invoiceNumber = payoutRow.invoice_number as string | null;

    if (!storagePath || !invoiceNumber) {
      const issued = await issueSelfBilledInvoiceForPayout(admin, requestId);
      if (!issued) {
        return jsonResponse({ error: "invoice_not_available" }, 409);
      }
      storagePath = issued.storagePath;
      invoiceNumber = issued.invoiceNumber;
    }

    const { data: signed, error: signError } = await admin.storage
      .from("self_billing_invoices")
      .createSignedUrl(storagePath, 3600);

    if (signError || !signed?.signedUrl) {
      return jsonResponse(
        { error: "signed_url_failed", message: signError?.message || "unknown" },
        500,
      );
    }

    return jsonResponse({
      request_id: requestId,
      invoice_number: invoiceNumber,
      signed_url: signed.signedUrl,
      expires_in: 3600,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "auth_required") return jsonResponse({ error: "auth_required" }, 401);
    if (message.startsWith("missing_env:")) {
      return jsonResponse({ error: "server_misconfigured", message }, 500);
    }
    console.error("get-mentor-payout-invoice:", message);
    return jsonResponse({ error: "internal_error", message }, 500);
  }
});
