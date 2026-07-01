import { getAgentOpenAI } from "@/lib/agents/clients";
import {
  AGENT_CHAT_MODEL,
  CONTENT_GENERATION_NODE_NAMES,
} from "@/lib/agents/config";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import {
  RETRIEVE_SYSTEM_PROMPT,
  buildRetrieveUserPrompt,
} from "@/lib/agents/content_generation/prompts/retrieve";
import { buildMockAcademicBlocks } from "@/lib/agents/content_generation/services/retrieval";
import type { AgentStateType } from "@/lib/agents/state";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  fetchYksChunksForTopic,
  formatYksChunksForContext,
} from "@/lib/yks-chunks/rag";

/** Retrieve: yks_chunks RAG veya yedek LLM bağlamı üretir. */
export async function retrieveNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const step = CONTENT_GENERATION_NODE_NAMES.retrieve;

  if (state.error) {
    return { steps: [step] };
  }

  if (!state.topic?.trim()) {
    return { error: "Öğrenci talebi gerekli.", steps: [step] };
  }

  if (!state.classification) {
    return { error: "Sınıflandırma verisi eksik.", steps: [step] };
  }

  try {
    const openai = getAgentOpenAI();
    const supabase = createSupabaseServerClient();

    if (supabase) {
      const matches = await fetchYksChunksForTopic(
        supabase,
        openai,
        state.topic,
        state.classification,
      );

      if (matches.length > 0) {
        return {
          academicContext: formatYksChunksForContext(matches),
          steps: [step],
        };
      }
    }

    const seedBlocks = buildMockAcademicBlocks(
      state.topic,
      state.classification,
    );

    const completion = await openai.chat.completions.create(
      buildChatCompletionParams(
        AGENT_CHAT_MODEL,
        [
          { role: "system", content: RETRIEVE_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildRetrieveUserPrompt({
              topic: state.topic,
              classificationJson: JSON.stringify(
                state.classification,
                null,
                2,
              ),
              archiveSnippets: seedBlocks,
            }),
          },
        ],
        { temperature: 0.2 },
      ),
    );

    const academicContext = completion.choices[0]?.message?.content?.trim();
    if (!academicContext) {
      return {
        academicContext: seedBlocks,
        steps: [step],
      };
    }

    return { academicContext, steps: [step] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Retrieve ajanı başarısız.";
    return { error: message, steps: [step] };
  }
}
