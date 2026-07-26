import { resolveNotalAuth } from "@/lib/notal/auth-server";
import {
  createNotalConversation,
  listNotalConversations,
} from "@/lib/notal/conversations-server";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  try {
    const conversations = await listNotalConversations(
      auth.supabase,
      auth.user.id,
    );
    return Response.json({ conversations });
  } catch (error) {
    console.error("[notal] list conversations:", error);
    return jsonError("list_failed", 500);
  }
}

export async function POST(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  let title = "Yeni sohbet";
  try {
    const body = (await request.json()) as { title?: unknown };
    if (typeof body?.title === "string" && body.title.trim()) {
      title = body.title.trim();
    }
  } catch {
    /* empty body ok */
  }

  try {
    const conversation = await createNotalConversation(
      auth.supabase,
      auth.user.id,
      title,
    );
    return Response.json({ conversation }, { status: 201 });
  } catch (error) {
    console.error("[notal] create conversation:", error);
    return jsonError("create_failed", 500);
  }
}
