/** Paylaşılan multi-agent yapılandırması */

export const AGENT_CHAT_MODEL =
  process.env.AGENT_CHAT_MODEL?.trim() ||
  process.env.NOTAL_GRAPH_CHAT_MODEL?.trim() ||
  process.env.OPENAI_MODEL?.trim() ||
  "gpt-4o-mini";

export const AGENT_CLASSIFIER_MODEL =
  process.env.AGENT_CLASSIFIER_MODEL?.trim() ||
  process.env.NOTAL_GRAPH_CLASSIFIER_MODEL?.trim() ||
  "gpt-4o-mini";

export const AGENT_EMBEDDING_MODEL = "text-embedding-3-small";

export const AGENT_RAG_MATCH_COUNT = 8;
export const AGENT_RAG_MATCH_THRESHOLD = 0.7;

export const AGENT_CHAT_TEMPERATURE = 0.4;
export const AGENT_MAX_OUTPUT = 8192;

export const CONTENT_GENERATION_NODE_NAMES = {
  classify: "classify",
  retrieve: "retrieve",
  write: "write",
  illustrator: "illustrator",
  polish: "polish",
} as const;
