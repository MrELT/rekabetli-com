import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey =
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export async function POST(request: Request) {
  const config = getSupabaseConfig();
  if (!config) return jsonError("Sunucu yapılandırması eksik.", 500);

  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) return jsonError("Oturum gerekli.", 401);

  const userClient = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return jsonError("Oturum doğrulanamadı.", 401);

  const { data: adminRow, error: adminError } = await userClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    return jsonError("Bu işlem için admin yetkisi gerekli.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Geçersiz JSON.", 400);
  }

  const functionResponse = await fetch(
    `${config.url}/functions/v1/send-campaign-email`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: config.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const result = await functionResponse.json().catch(() => null);
  if (!result) {
    return jsonError(
      `Kampanya fonksiyonu yanıt vermedi (${functionResponse.status}).`,
      502,
    );
  }

  return Response.json(result, { status: functionResponse.status });
}
