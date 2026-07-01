import OpenAI from "openai";

import { guardedOpenAiRequest } from "@/lib/openai/request-guard";

let openaiClient: OpenAI | null = null;

function wrapOpenAiClient(client: OpenAI): OpenAI {
  const chatCreate = client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create = ((
    ...args: Parameters<typeof chatCreate>
  ) => guardedOpenAiRequest(() => chatCreate(...args))) as typeof chatCreate;

  const embeddingsCreate = client.embeddings.create.bind(client.embeddings);
  client.embeddings.create = ((
    ...args: Parameters<typeof embeddingsCreate>
  ) =>
    guardedOpenAiRequest(() => embeddingsCreate(...args))) as typeof embeddingsCreate;

  return client;
}

export function getAgentOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY eksik.");
  }

  if (!openaiClient) {
    openaiClient = wrapOpenAiClient(new OpenAI({ apiKey }));
  }

  return openaiClient;
}
