import {
  UNIVERSITY_PLACEHOLDER_MESSAGE,
  UNIVERSITY_PLACEHOLDER_NODE_NAME,
} from "@/lib/agents/supervisor/constants";
import type { AgentStateType } from "@/lib/agents/state";

/** Üniversite ayağı için geçici yer tutucu düğüm. */
export async function universityPlaceholderNode(
  _state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  return {
    draft: UNIVERSITY_PLACEHOLDER_MESSAGE,
    content: UNIVERSITY_PLACEHOLDER_MESSAGE,
    steps: [UNIVERSITY_PLACEHOLDER_NODE_NAME],
  };
}
