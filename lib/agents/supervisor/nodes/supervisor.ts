import { getAgentOpenAI } from "@/lib/agents/clients";
import { AGENT_CLASSIFIER_MODEL } from "@/lib/agents/config";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import {
  SUPERVISOR_SYSTEM_PROMPT,
  buildSupervisorUserPrompt,
} from "@/lib/agents/supervisor/prompts/supervisor";
import {
  normalizeEducationLevel,
  parseEducationLevelPayload,
  type EducationLevel,
} from "@/lib/agents/supervisor/types";
import type { AgentStateType } from "@/lib/agents/state";

export const SUPERVISOR_NODE_NAME = "supervisor";

function inferEducationLevelFromTopic(topic: string): EducationLevel {
  const normalized = topic.toLowerCase();

  const universitySignals = [
    "üniversite",
    "universite",
    "fakülte",
    "fakulte",
    "vize",
    "final",
    "kalkülüs",
    "kalkulus",
    "diferansiyel",
    "lineer cebir",
    "mühendislik",
    "muhendislik",
  ];

  const highSchoolSignals = [
    "tyt",
    "ayt",
    "yks",
    "lgs",
    "lise",
    "9. sınıf",
    "10. sınıf",
    "11. sınıf",
    "12. sınıf",
  ];

  if (universitySignals.some((signal) => normalized.includes(signal))) {
    return "university";
  }

  if (highSchoolSignals.some((signal) => normalized.includes(signal))) {
    return "high_school";
  }

  return "unknown";
}

/** Supervisor: öğrenci talebine göre eğitim seviyesini belirler. */
export async function supervisorNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const step = SUPERVISOR_NODE_NAME;

  if (!state.topic?.trim()) {
    return { error: "Öğrenci talebi gerekli.", steps: [step] };
  }

  try {
    const openai = getAgentOpenAI();
    const completion = await openai.chat.completions.create(
      buildChatCompletionParams(
        AGENT_CLASSIFIER_MODEL,
        [
          { role: "system", content: SUPERVISOR_SYSTEM_PROMPT },
          { role: "user", content: buildSupervisorUserPrompt(state.topic) },
        ],
        { temperature: 0.1, responseFormat: { type: "json_object" } },
      ),
    );

    const raw = completion.choices[0]?.message?.content?.trim();
    let educationLevel: EducationLevel = "unknown";

    if (raw) {
      try {
        const parsed = parseEducationLevelPayload(JSON.parse(raw));
        if (parsed) {
          educationLevel = parsed;
        }
      } catch {
        educationLevel = normalizeEducationLevel(raw);
      }
    }

    if (educationLevel === "unknown") {
      educationLevel = inferEducationLevelFromTopic(state.topic);
    }

    return { educationLevel, steps: [step] };
  } catch {
    return {
      educationLevel: inferEducationLevelFromTopic(state.topic),
      steps: [step],
    };
  }
}
