import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export async function assertApiRateLimit(
  admin: SupabaseClient,
  bucketKey: string,
  maxHits: number,
  windowSeconds: number,
): Promise<void> {
  const { error } = await admin.rpc("assert_api_rate_limit", {
    p_bucket_key: bucketKey,
    p_max_hits: maxHits,
    p_window_seconds: windowSeconds,
  });

  if (error?.message?.includes("rate_limit_exceeded")) {
    throw new Error("rate_limit_exceeded");
  }

  if (error) {
    throw new Error(`rate_limit_check_failed:${error.message}`);
  }
}

export function createServiceClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
