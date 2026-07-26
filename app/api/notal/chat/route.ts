import { resolveNotalAuth } from "@/lib/notal/auth-server";
import {
  runNotalOrchestrator,
  type NotalChatTurn,
} from "@/lib/notal/orchestrator";
import {
  ensureOwnedConversation,
  insertNotalMessage,
  touchNotalConversation,
} from "@/lib/notal/conversations-server";

export const runtime = "nodejs";

const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 8000;

type BodyMessage = {
  role?: unknown;
  content?: unknown;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function parseMessages(raw: unknown): NotalChatTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) {
    return null;
  }

  const messages: NotalChatTurn[] = [];
  for (const item of raw as BodyMessage[]) {
    const role = item?.role;
    const content = typeof item?.content === "string" ? item.content.trim() : "";
    if ((role !== "user" && role !== "assistant") || !content) return null;
    if (content.length > MAX_CONTENT_CHARS) return null;
    messages.push({ role, content });
  }

  if (messages[messages.length - 1]?.role !== "user") return null;
  return messages;
}

export async function POST(request: Request) {
  const auth = await resolveNotalAuth(request);
  if (!auth) {
    return jsonError("auth_required", 401);
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return jsonError("openai_not_configured", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_json", 400);
  }

  const bodyObj =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const messages = parseMessages(bodyObj.messages);
  if (!messages) {
    return jsonError("invalid_messages", 400);
  }

  const conversationIdRaw =
    typeof bodyObj.conversationId === "string"
      ? bodyObj.conversationId.trim()
      : "";

  const lastUser = messages[messages.length - 1]!;

  let conversationId: string;
  let conversationCreated = false;
  try {
    const ensured = await ensureOwnedConversation(
      auth.supabase,
      auth.user.id,
      conversationIdRaw || null,
      lastUser.content,
    );
    conversationId = ensured.id;
    conversationCreated = ensured.created;

    await insertNotalMessage(
      auth.supabase,
      conversationId,
      "user",
      lastUser.content,
    );

    if (!conversationCreated) {
      await touchNotalConversation(auth.supabase, conversationId);
    }
  } catch (error) {
    console.error("[notal] persist user message:", error);
    const code =
      error instanceof Error && error.message === "conversation_not_found"
        ? "conversation_not_found"
        : "persist_failed";
    return jsonError(code, code === "conversation_not_found" ? 404 : 500);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };

      send({
        type: "meta",
        conversationId,
        conversationCreated,
      });

      let assembled = "";

      try {
        for await (const event of runNotalOrchestrator({
          messages,
          supabase: auth.supabase,
          userId: auth.user.id,
          signal: request.signal,
        })) {
          if (event.type === "delta") {
            assembled += event.text;
            send({ type: "delta", text: event.text });
          } else if (event.type === "tool_start" || event.type === "tool_done") {
            send({ type: event.type, name: event.name });
          } else if (event.type === "error") {
            send({ type: "error", message: event.message });
          }
        }

        if (assembled.trim()) {
          try {
            await insertNotalMessage(
              auth.supabase,
              conversationId,
              "assistant",
              assembled.trim(),
            );
            await touchNotalConversation(auth.supabase, conversationId);
          } catch (error) {
            console.error("[notal] persist assistant message:", error);
            send({ type: "error", message: "persist_failed" });
          }
        }

        send({ type: "done", conversationId });
      } catch (error) {
        const message =
          error instanceof Error && error.name === "AbortError"
            ? "aborted"
            : error instanceof Error &&
                error.message === "missing_openai_api_key"
              ? "openai_not_configured"
              : "orchestrator_error";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
