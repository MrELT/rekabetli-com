import OpenAI from "openai";

export const NOTAL_ORCHESTRATOR_MODEL = "gpt-5.6-sol";
export const NOTAL_PLANNER_MODEL = "gpt-5.6-luna";

export function getNotalOrchestratorModel(): string {
  const fromEnv = process.env.OPENAI_MODEL?.trim();
  if (fromEnv) return fromEnv;
  return NOTAL_ORCHESTRATOR_MODEL;
}

export function getNotalPlannerModel(): string {
  const fromEnv = process.env.OPENAI_PLANNER_MODEL?.trim();
  if (fromEnv) return fromEnv;
  return NOTAL_PLANNER_MODEL;
}

export function createNotalOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("missing_openai_api_key");
  }
  return new OpenAI({ apiKey });
}
