import { getAgentOpenAI } from "@/lib/agents/clients";
import {
  AGENT_CHAT_MODEL,
  AGENT_CHAT_TEMPERATURE,
  CONTENT_GENERATION_NODE_NAMES,
} from "@/lib/agents/config";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import {
  WRITE_SYSTEM_PROMPT,
  buildWriteUserPrompt,
} from "@/lib/agents/content_generation/prompts/write";
import type { AgentStateType } from "@/lib/agents/state";

/** Write: ham veriyi pedagojik ders notuna dönüştürür. */
export async function writeNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const step = CONTENT_GENERATION_NODE_NAMES.write;

  if (state.error) {
    return { steps: [step] };
  }

  if (!state.topic?.trim()) {
    return { error: "Öğrenci talebi gerekli.", steps: [step] };
  }

  if (!state.classification) {
    return { error: "Sınıflandırma verisi eksik.", steps: [step] };
  }

  if (!state.academicContext?.trim()) {
    return { error: "Akademik bağlam hazır değil.", steps: [step] };
  }

  try {
    const openai = getAgentOpenAI();
    const completion = await openai.chat.completions.create(
      buildChatCompletionParams(
        AGENT_CHAT_MODEL,
        [
          { role: "system", content: WRITE_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildWriteUserPrompt({
              topic: state.topic,
              classificationJson: JSON.stringify(
                state.classification,
                null,
                2,
              ),
              academicContext: state.academicContext,
            }),
          },
        ],
        { temperature: AGENT_CHAT_TEMPERATURE },
      ),
    );

    const draft = completion.choices[0]?.message?.content?.trim();
    if (!draft) {
      return { error: "Writer ajanı boş yanıt döndü.", steps: [step] };
    }

    return { draft, steps: [step] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Write ajanı başarısız.";
    return { error: message, steps: [step] };
  }
}
