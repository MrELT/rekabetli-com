import { resolveNotalAuth } from "@/lib/notal/auth-server";
import {
  deleteNotalConversation,
  getNotalConversationWithMessages,
} from "@/lib/notal/conversations-server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  const { id } = await context.params;
  if (!id) return jsonError("invalid_id", 400);

  try {
    const result = await getNotalConversationWithMessages(
      auth.supabase,
      auth.user.id,
      id,
    );
    if (!result) return jsonError("not_found", 404);
    return Response.json(result);
  } catch (error) {
    console.error("[notal] get conversation:", error);
    return jsonError("get_failed", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await resolveNotalAuth(request);
  if (!auth) return jsonError("auth_required", 401);

  const { id } = await context.params;
  if (!id) return jsonError("invalid_id", 400);

  try {
    const deleted = await deleteNotalConversation(
      auth.supabase,
      auth.user.id,
      id,
    );
    if (!deleted) return jsonError("not_found", 404);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[notal] delete conversation:", error);
    return jsonError("delete_failed", 500);
  }
}
