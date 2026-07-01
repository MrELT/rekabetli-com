import { getAgentOpenAI } from "@/lib/agents/clients";
import { CONTENT_GENERATION_NODE_NAMES } from "@/lib/agents/config";
import {
  applyVisualReplacements,
  extractVisualRequests,
  stripAllRemainingVisualTags,
  stripVisualRequestFromDraft,
  type VisualRequest,
} from "@/lib/agents/content_generation/utils/visual-tags";
import {
  buildRichMarkdownFromMatch,
  matchNotesImages,
} from "@/lib/notes-images/rag";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { AgentStateType } from "@/lib/agents/state";
import {
  buildMarkdownFromYksFigure,
  matchYksFiguresForVisualRequest,
} from "@/lib/yks-figures/rag";

function buildRagQuery(request: VisualRequest, topic: string): string {
  return [
    `Ana konu: ${topic.trim()}`,
    `Görsel talebi: ${request.description.trim()}`,
    `Tür: ${request.type}`,
    `İçerik türü: tanım, açıklama, örnek soru ve bağlam metni`,
  ].join("\n");
}

async function resolveVisualWithRag(
  request: VisualRequest,
  state: AgentStateType,
): Promise<{ markdown: string | null; matched: boolean }> {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return { markdown: null, matched: false };
  }

  try {
    const openai = getAgentOpenAI();

    const yksMatch = await matchYksFiguresForVisualRequest(supabase, openai, {
      topic: state.topic,
      requestDescription: request.description,
      classification: state.classification,
    });

    if (yksMatch) {
      return {
        markdown: buildMarkdownFromYksFigure(yksMatch),
        matched: true,
      };
    }

    const legacyMatch = await matchNotesImages(
      supabase,
      openai,
      buildRagQuery(request, state.topic),
    );

    if (!legacyMatch) {
      return { markdown: null, matched: false };
    }

    return {
      markdown: buildRichMarkdownFromMatch(legacyMatch, {
        topic: state.topic,
        requestDescription: request.description,
      }),
      matched: true,
    };
  } catch (error) {
    console.warn("[illustrator] Görsel RAG hatası:", error);
    return { markdown: null, matched: false };
  }
}

/** Illustrator: [VISUAL_REQ] → yks_figures (Faz B) veya notes_images (legacy). */
export async function illustratorNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const step = CONTENT_GENERATION_NODE_NAMES.illustrator;

  if (state.error) {
    return { steps: [step] };
  }

  if (!state.draft?.trim()) {
    return { error: "İllüstrasyon için taslak bulunamadı.", steps: [step] };
  }

  const requests = extractVisualRequests(state.draft);
  if (!requests.length) {
    return { hasVisuals: false, steps: [step] };
  }

  let draft = state.draft;
  let hasVisuals = false;

  for (const request of requests) {
    const { markdown, matched } = await resolveVisualWithRag(request, state);

    if (matched && markdown) {
      draft = applyVisualReplacements(draft, [
        { tag: request.fullTag, markdown },
      ]);
      hasVisuals = true;
      continue;
    }

    draft = stripVisualRequestFromDraft(draft, request);
  }

  draft = stripAllRemainingVisualTags(draft);

  return {
    draft,
    hasVisuals,
    steps: [step],
  };
}
