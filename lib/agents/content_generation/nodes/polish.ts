import { getAgentOpenAI } from "@/lib/agents/clients";
import {
  AGENT_CHAT_MODEL,
  CONTENT_GENERATION_NODE_NAMES,
} from "@/lib/agents/config";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import {
  POLISH_SYSTEM_PROMPT,
  buildPolishUserPrompt,
} from "@/lib/agents/content_generation/prompts/polish";
import type { AgentStateType } from "@/lib/agents/state";

/** Polish: taslağı frontend için Markdown + LaTeX formatına sokar. */
export async function polishNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const step = CONTENT_GENERATION_NODE_NAMES.polish;

  if (state.error) {
    return { steps: [step] };
  }

  if (!state.draft?.trim()) {
    return { error: "Düzenlenecek taslak bulunamadı.", steps: [step] };
  }

  try {
    const openai = getAgentOpenAI();
    const maxOutput = Math.min(
      Math.max(state.draft.length + 800, 2000),
      8192,
    );

    const completion = await openai.chat.completions.create(
      buildChatCompletionParams(
        AGENT_CHAT_MODEL,
        [
          { role: "system", content: POLISH_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildPolishUserPrompt(state.topic, state.draft),
          },
        ],
        { temperature: 0.2, maxOutput },
      ),
    );

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      return { content: state.draft, steps: [step] };
    }

    return { content, steps: [step] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Polish ajanı başarısız.";
    return { error: message, steps: [step] };
  }
}
