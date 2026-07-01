import type { LearningOutcome } from "@/lib/agents/exam_prep/alignment-types";
import type { PdfReadMode } from "@/lib/agents/exam_prep/types";

export type PersistContentRole = "material" | "question" | "curriculum";

export interface ExamPrepRichMetadata {
  pipeline: "exam_prep";
  ownerUserId: string;
  pdfId: string;
  contentRole: PersistContentRole;
  contentSummary: string;
  learningOutcomes: LearningOutcome[];
  keyConcepts: string[];
  questionNumber?: number;
  questionType?: string;
  skillsTested?: string[];
  examGoal?: string;
  /** Müfredat belgesi: ünite / tema */
  unitName?: string;
  /** Resmi kazanım kodu (ör. M.9.1.1) */
  officialOutcomeCode?: string;
  /** Müfredat bölümü: ünite, tema, alt tema */
  curriculumSection?: string;
  /** Envanter ajanı kazanımları kullanıldı (hafif etiket) */
  agentInventoryUsed?: boolean;
}

export interface PdfPersistenceStats {
  pdfId: string;
  fileName: string;
  role: PersistContentRole;
  mode: PdfReadMode;
  storedChunks: number;
  storedFigures: number;
  skipped: number;
  errors: string[];
}

export interface ExamPrepPersistenceResult {
  enabled: boolean;
  pdfs: PdfPersistenceStats[];
  totalChunks: number;
  totalFigures: number;
  errors: string[];
}

export interface LabeledExamPrepChunk {
  chunkType: string;
  subject: string;
  curriculum: string;
  topic: string;
  subtopic: string;
  content: string;
  difficulty: string;
  rich: ExamPrepRichMetadata;
}
