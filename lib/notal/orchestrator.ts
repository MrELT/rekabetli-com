import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  executePlannerTool,
  PLANNER_TOOLS,
} from "@/lib/notal/planner/tools";

export const NOTAL_ORCHESTRATOR_MODEL = "gpt-5.6-sol";

export const NOTAL_ORCHESTRATOR_INSTRUCTIONS = `Sen NotAl orchestrator'sın (GPT-5.6 Sol).
Türkçe, net ve yardımcı konuş.

Elindeki ajan:
- Planner: günlük/haftalık çalışma planı oluşturur, günceller, listeler, siler.
  Saatleri Europe/Istanbul diliminde ISO 8601 yaz.
  Kullanıcı plan istediğinde planner_* araçlarını kullan.
  Google Takvim senkronu için blok oluştururken sync_google=true verebilirsin (kullanıcı bağlıysa).

Takvim UI NotAl içinde "Takvim" menüsünde görünür; planları orada da görebilir.
Matematik için LaTeX kullanabilirsin ($...$ veya $$...$$).`;

export type NotalChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type OrchestratorStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_done"; name: string }
  | { type: "error"; message: string };

export function getNotalOrchestratorModel(): string {
  const fromEnv = process.env.OPENAI_MODEL?.trim();
  if (fromEnv) return fromEnv;
  return NOTAL_ORCHESTRATOR_MODEL;
}

export function createNotalOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("missing_openai_api_key");
  }
  return new OpenAI({ apiKey });
}

type ResponseOutputItem = {
  type?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  id?: string;
};

function extractFunctionCalls(response: {
  output?: ResponseOutputItem[];
}): Array<{ name: string; arguments: string; call_id: string }> {
  const calls: Array<{ name: string; arguments: string; call_id: string }> = [];
  for (const item of response.output || []) {
    if (item.type === "function_call" && item.name) {
      calls.push({
        name: item.name,
        arguments: item.arguments || "{}",
        call_id: item.call_id || item.id || item.name,
      });
    }
  }
  return calls;
}

function extractOutputText(response: {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const parts: string[] = [];
  for (const item of response.output || []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

/**
 * Tool-calling döngüsü + final yanıtı parça parça yayar.
 */
export async function* runNotalOrchestrator(options: {
  messages: NotalChatTurn[];
  supabase: SupabaseClient;
  userId: string;
  signal?: AbortSignal;
}): AsyncGenerator<OrchestratorStreamEvent> {
  const openai = createNotalOpenAI();
  const model = getNotalOrchestratorModel();

  let input: Array<Record<string, unknown>> = options.messages.map(
    (message) => ({
      role: message.role,
      content: message.content,
    }),
  );

  for (let round = 0; round < 6; round += 1) {
    if (options.signal?.aborted) {
      yield { type: "error", message: "aborted" };
      return;
    }

    const response = await openai.responses.create(
      {
        model,
        instructions: NOTAL_ORCHESTRATOR_INSTRUCTIONS,
        input: input as never,
        tools: PLANNER_TOOLS as never,
        reasoning: { effort: "low" },
      },
      options.signal ? { signal: options.signal } : undefined,
    );

    const calls = extractFunctionCalls(response as never);
    if (!calls.length) {
      const text = extractOutputText(response as never);
      if (!text) {
        yield { type: "error", message: "empty_orchestrator_response" };
        return;
      }

      // Basit chunking — UI'da akış hissi
      const chunkSize = 24;
      for (let i = 0; i < text.length; i += chunkSize) {
        yield { type: "delta", text: text.slice(i, i + chunkSize) };
      }
      return;
    }

    input = [
      ...input,
      ...((response.output || []) as unknown as Array<Record<string, unknown>>),
    ];

    for (const call of calls) {
      yield { type: "tool_start", name: call.name };
      const toolResult = await executePlannerTool({
        supabase: options.supabase,
        userId: options.userId,
        name: call.name,
        argsJson: call.arguments,
      });
      yield { type: "tool_done", name: call.name };

      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: toolResult,
      });
    }
  }

  yield {
    type: "error",
    message: "tool_loop_limit",
  };
}
