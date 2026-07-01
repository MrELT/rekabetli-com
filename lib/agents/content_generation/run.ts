import type { NotalDifficulty } from "@/lib/notal-difficulty";
import { contentGenerationGraph } from "@/lib/agents/content_generation/graph";
import type { ClassificationResult } from "@/lib/agents/content_generation/types";

export interface ContentGenerationRunInput {
  topic: string;
  difficulty?: NotalDifficulty | null;
}

export interface ContentGenerationRunResult {
  topic: string;
  classification: ClassificationResult;
  difficulty: NotalDifficulty | null;
  academicContext: string;
  draft: string;
  content: string;
  hasVisuals: boolean;
  steps: string[];
}

export async function runContentGenerationGraph(
  input: ContentGenerationRunInput,
): Promise<ContentGenerationRunResult> {
  const result = await contentGenerationGraph.invoke({
    topic: input.topic.trim(),
    educationLevel: "unknown",
    classification: null,
    academicContext: "",
    draft: "",
    content: "",
    hasVisuals: false,
    error: null,
    steps: [],
    difficulty: input.difficulty ?? null,
    subject: null,
  });

  if (result.error) {
    throw new Error(result.error);
  }

  if (!result.classification) {
    throw new Error("Sınıflandırma üretilemedi.");
  }

  const content = result.content?.trim();
  if (!content) {
    throw new Error("Not üretilemedi.");
  }

  return {
    topic: result.topic,
    classification: result.classification,
    difficulty: result.difficulty,
    academicContext: result.academicContext,
    draft: result.draft,
    content,
    hasVisuals: result.hasVisuals,
    steps: result.steps,
  };
}
