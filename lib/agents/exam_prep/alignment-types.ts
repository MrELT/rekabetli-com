/** Tek bir kazanım / öğrenme çıktısı */
export interface LearningOutcome {
  code: string;
  title: string;
  unit: string;
}

/** Eşleşen kazanım çifti */
export interface MatchedOutcomePair {
  questionOutcome: LearningOutcome;
  materialOutcome: LearningOutcome;
  similarity: number;
}

/** Konu anlatımı ↔ soru kazanım uyuşması */
export interface KazanımAlignmentResult {
  /** Soru kazanımlarının anlatımla örtüşme oranı (0–100) */
  questionCoveragePct: number;
  /** Anlatım kazanımlarının sorularla karşılanma oranı (0–100) */
  materialCoveragePct: number;
  /** Genel uyum skoru (iki yönlü ortalama) */
  overallAlignmentPct: number;
  matchedCount: number;
  totalQuestionOutcomes: number;
  totalMaterialOutcomes: number;
  matchedPairs: MatchedOutcomePair[];
  unmatchedQuestionOutcomes: LearningOutcome[];
  unmatchedMaterialOutcomes: LearningOutcome[];
}
