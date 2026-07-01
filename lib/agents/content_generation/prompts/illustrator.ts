/**
 * @deprecated Illustrator artık LLM ile Mermaid üretmez; PDF/Görsel RAG kullanır.
 * Bu dosya geriye dönük export uyumluluğu için tutulur.
 */
export const ILLUSTRATOR_SYSTEM_PROMPT =
  "Illustrator düğümü artık notes_images pgvector RAG araması kullanır.";

export function buildIllustratorUserPrompt(): string {
  return "";
}
