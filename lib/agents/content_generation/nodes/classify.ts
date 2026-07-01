import { getAgentOpenAI } from "@/lib/agents/clients";
import {
  AGENT_CLASSIFIER_MODEL,
  CONTENT_GENERATION_NODE_NAMES,
} from "@/lib/agents/config";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import {
  CLASSIFY_SYSTEM_PROMPT,
  buildClassifyUserPrompt,
} from "@/lib/agents/content_generation/prompts/classify";
import {
  classificationLevelToDifficulty,
  parseClassificationPayload,
} from "@/lib/agents/content_generation/types";
import type { AgentStateType } from "@/lib/agents/state";

/** Classify: öğrenci talebini triyaj eder. */
export async function classifyNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const step = CONTENT_GENERATION_NODE_NAMES.classify;

  if (!state.topic?.trim()) {
    return { error: "Öğrenci talebi gerekli.", steps: [step] };
  }

  try {
    const openai = getAgentOpenAI();
    const completion = await openai.chat.completions.create(
      buildChatCompletionParams(
        AGENT_CLASSIFIER_MODEL,
        [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: buildClassifyUserPrompt(state.topic) },
        ],
        { temperature: 0.1, responseFormat: { type: "json_object" } },
      ),
    );

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      return { error: "Sınıflandırma yanıtı boş.", steps: [step] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: "Sınıflandırma JSON parse edilemedi.", steps: [step] };
    }

    const classification = parseClassificationPayload(parsed);
    if (!classification) {
      return { error: "Geçersiz sınıflandırma çıktısı.", steps: [step] };
    }

    return {
      classification,
      difficulty:
        state.difficulty ??
        classificationLevelToDifficulty(classification.level),
      steps: [step],
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Classify ajanı başarısız.";
    return { error: message, steps: [step] };
  }
}
