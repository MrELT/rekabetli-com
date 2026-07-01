import type { NotalDifficulty } from "@/lib/notal-difficulty";
import { mainNotalGraph } from "@/lib/agents/supervisor/graph";
import type { ClassificationResult } from "@/lib/agents/content_generation/types";
import type { EducationLevel } from "@/lib/agents/supervisor/types";
import { UNIVERSITY_PLACEHOLDER_MESSAGE } from "@/lib/agents/supervisor/constants";

export interface MainNotalRunInput {
  topic: string;
  difficulty?: NotalDifficulty | null;
  educationLevel?: EducationLevel | null;
}

export interface MainNotalRunResult {
  topic: string;
  educationLevel: EducationLevel;
  classification: ClassificationResult | null;
  difficulty: NotalDifficulty | null;
  academicContext: string;
  draft: string;
  content: string;
  hasVisuals: boolean;
  steps: string[];
  isUniversityPlaceholder: boolean;
}

function createInitialAgentState(input: MainNotalRunInput) {
  return {
    topic: input.topic.trim(),
    educationLevel: input.educationLevel ?? ("unknown" as EducationLevel),
    classification: null,
    academicContext: "",
    draft: "",
    content: "",
    hasVisuals: false,
    error: null,
    steps: [] as string[],
    difficulty: input.difficulty ?? null,
    subject: null,
  };
}

/** Ana NotAl supervisor grafiğini çalıştırır. */
export async function runMainNotalGraph(
  input: MainNotalRunInput,
): Promise<MainNotalRunResult> {
  const result = await mainNotalGraph.invoke(createInitialAgentState(input));

  if (result.error) {
    throw new Error(result.error);
  }

  const content = result.content?.trim();
  if (!content) {
    throw new Error("Not üretilemedi.");
  }

  const isUniversityPlaceholder = content === UNIVERSITY_PLACEHOLDER_MESSAGE;

  if (!isUniversityPlaceholder && !result.classification) {
    throw new Error("Sınıflandırma üretilemedi.");
  }

  return {
    topic: result.topic,
    educationLevel: result.educationLevel,
    classification: result.classification,
    difficulty: result.difficulty,
    academicContext: result.academicContext,
    draft: result.draft,
    content,
    hasVisuals: result.hasVisuals,
    steps: result.steps,
    isUniversityPlaceholder,
  };
}
