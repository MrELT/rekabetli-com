import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { AGENT_MAX_OUTPUT } from "@/lib/agents/config";

export function usesMaxCompletionTokens(model: string): boolean {
  return /^gpt-5|^o\d/i.test(model);
}

export function buildChatCompletionParams(
  model: string,
  messages: ChatCompletionCreateParamsNonStreaming["messages"],
  options?: {
    temperature?: number;
    maxOutput?: number;
    responseFormat?: ChatCompletionCreateParamsNonStreaming["response_format"];
  },
): ChatCompletionCreateParamsNonStreaming {
  const maxOutput = options?.maxOutput ?? AGENT_MAX_OUTPUT;
  const base: ChatCompletionCreateParamsNonStreaming = {
    model,
    temperature: options?.temperature ?? 0.4,
    messages,
    ...(options?.responseFormat ? { response_format: options.responseFormat } : {}),
  };

  if (usesMaxCompletionTokens(model)) {
    return { ...base, max_completion_tokens: maxOutput };
  }

  return { ...base, max_tokens: maxOutput };
}
