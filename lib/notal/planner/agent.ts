import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createNotalOpenAI,
  getNotalOrchestratorModel,
} from "@/lib/notal/openai-client";
import {
  extractFunctionCalls,
  extractOutputText,
} from "@/lib/notal/openai-helpers";
import {
  executePlannerTool,
  isPlannerMutationTool,
  PLANNER_TOOLS,
} from "@/lib/notal/planner/tools";
import { NOTAL_TZ } from "@/lib/notal/planner/types";

export const PLANNER_AGENT_INSTRUCTIONS = `Sen NotAl Planner ajanısın.
Görevin kullanıcının günlük/haftalık çalışma planını NotAl takvimine yazmak, güncellemek ve silmektir.

Kurallar:
- Saatleri ${NOTAL_TZ} diliminde ISO 8601 formatında yaz (ör. 2026-07-28T09:00:00+03:00).
- Güncelleme veya silme öncesi ilgili aralığı planner_list_blocks ile listele; doğru block_id kullan.
- Çakışan saatler oluşturma; gerekirse önce listele, sonra düzenle.
- Kısa ve net Türkçe özet ver; teknik id'leri kullanıcıya göstermek zorunda değilsin.
- Takvim değişikliğini doğrudan uygula; kullanıcıdan onay bekleme veya "yapayım mı" diye sorma.
- Google Takvim bağlıysa ekleme/güncelleme/silme otomatik senkronize edilir.
- Sadece takvim/plan işleri yap; ders anlatma veya genel sohbet yapma.`;

export type PlannerAgentResult = {
  ok: boolean;
  summary: string;
  calendarChanged: boolean;
  error?: string;
};

function istanbulNowIso(): string {
  return new Date().toLocaleString("tr-TR", { timeZone: NOTAL_TZ });
}

/**
 * Orchestrator'dan gelen doğal dil komutunu işler; CRUD araçlarını kendi döngüsünde çalıştırır.
 */
export async function runPlannerAgent(options: {
  command: string;
  supabase: SupabaseClient;
  userId: string;
  signal?: AbortSignal;
  onTool?: (phase: "start" | "done", name: string) => void;
}): Promise<PlannerAgentResult> {
  const openai = createNotalOpenAI();
  const model = getNotalOrchestratorModel();
  const command = options.command.trim();

  if (!command) {
    return {
      ok: false,
      summary: "",
      calendarChanged: false,
      error: "empty_command",
    };
  }

  let input: Array<Record<string, unknown>> = [
    {
      role: "user",
      content: `Komut: ${command}\n\nŞu an (${NOTAL_TZ}): ${istanbulNowIso()}`,
    },
  ];

  let calendarChanged = false;
  let lastError: string | undefined;

  for (let round = 0; round < 8; round += 1) {
    if (options.signal?.aborted) {
      return {
        ok: false,
        summary: "",
        calendarChanged,
        error: "aborted",
      };
    }

    const response = await openai.responses.create(
      {
        model,
        instructions: PLANNER_AGENT_INSTRUCTIONS,
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
        return {
          ok: false,
          summary: "",
          calendarChanged,
          error: lastError || "empty_planner_response",
        };
      }
      return { ok: true, summary: text, calendarChanged };
    }

    input = [
      ...input,
      ...((response.output || []) as unknown as Array<Record<string, unknown>>),
    ];

    for (const call of calls) {
      options.onTool?.("start", call.name);
      const toolResult = await executePlannerTool({
        supabase: options.supabase,
        userId: options.userId,
        name: call.name,
        argsJson: call.arguments,
      });
      options.onTool?.("done", call.name);

      if (isPlannerMutationTool(call.name)) {
        calendarChanged = true;
      }

      try {
        const parsed = JSON.parse(toolResult) as { ok?: boolean; error?: string };
        if (parsed.ok === false && parsed.error) {
          lastError = parsed.error;
        }
      } catch {
        /* ignore parse */
      }

      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: toolResult,
      });
    }
  }

  return {
    ok: false,
    summary: "",
    calendarChanged,
    error: "planner_tool_loop_limit",
  };
}
