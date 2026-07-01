import { Annotation } from "@langchain/langgraph";
import type { NotalDifficulty } from "@/lib/notal-difficulty";
import type { NotalSubject } from "@/lib/notal-subjects";
import type { ClassificationResult } from "@/lib/agents/content_generation/types";
import type { EducationLevel } from "@/lib/agents/supervisor/types";

/**
 * Supervisor (Patron) ve tüm alt grafiklerin paylaştığı durum şeması.
 */
export const AgentState = Annotation.Root({
  /** Öğrenci talebi / konu metni */
  topic: Annotation<string>,
  /** Öğrencinin eğitim seviyesi (supervisor yönlendirmesi) */
  educationLevel: Annotation<EducationLevel>({
    reducer: (left, right) => right ?? left,
    default: () => "unknown",
  }),
  /** Triyaj sınıflandırması (classify düğümü) */
  classification: Annotation<ClassificationResult | null>({
    reducer: (_left, right) => right ?? null,
    default: () => null,
  }),
  /** Retrieve düğümünün ürettiği ham akademik bloklar */
  academicContext: Annotation<string>,
  /** Write düğümü taslağı (illustrator sonrası güncellenebilir) */
  draft: Annotation<string>,
  /** Illustrator düğümünün görsel üretip üretmediği */
  hasVisuals: Annotation<boolean>({
    reducer: (left, right) => right ?? left,
    default: () => false,
  }),
  /** Polish düğümü nihai çıktısı */
  content: Annotation<string>,
  error: Annotation<string | null>,
  steps: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  /** İsteğe bağlı: dışarıdan gelen zorluk (classify level ile birleştirilebilir) */
  difficulty: Annotation<NotalDifficulty | null>({
    reducer: (_left, right) => right ?? null,
    default: () => null,
  }),
  /** Geriye dönük uyumluluk / metadata */
  subject: Annotation<NotalSubject | null>({
    reducer: (_left, right) => right ?? null,
    default: () => null,
  }),
});

export type AgentStateType = typeof AgentState.State;
export type AgentStateUpdate = typeof AgentState.Update;
