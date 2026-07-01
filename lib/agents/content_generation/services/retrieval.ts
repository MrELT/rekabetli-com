import type { ClassificationResult } from "@/lib/agents/content_generation/types";

/** Agent retrieve: müfredat sınıflandırmasına göre yapılandırılmış bağlam şablonu. */
export function buildMockAcademicBlocks(
  topic: string,
  classification: ClassificationResult,
): string {
  return [
    `[Müfredat: ${classification.curriculum}]`,
    `Konu: ${topic.trim()}`,
    `Niyet: ${classification.intent}`,
    `Seviye: ${classification.level}`,
    "",
    "Not: yks_chunks arşivinde eşleşme bulunamadı; temel şablon kullanılıyor.",
  ].join("\n");
}
