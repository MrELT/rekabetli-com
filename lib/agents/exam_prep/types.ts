import type { KazanımAlignmentResult, LearningOutcome } from "@/lib/agents/exam_prep/alignment-types";
import type { ExamPrepPersistenceResult } from "@/lib/agents/exam_prep/persistence/types";
import type { ProgressCallback } from "@/lib/exam-prep/progress";

export type { LearningOutcome, KazanımAlignmentResult };

export const EXAM_PREP_CURRICULA = ["TYT", "AYT", "genel"] as const;
export type ExamPrepCurriculum = (typeof EXAM_PREP_CURRICULA)[number];

export type StudentPdfCategory = "material" | "question" | "curriculum";
export type TransferDirection = "to_questions" | "to_materials";
export type PdfReadMode = "text" | "vision";

export interface StudentPdfPageImage {
  pageNumber: number;
  pngBase64: string;
}

export interface StudentPdfInput {
  id: string;
  fileName: string;
  category: StudentPdfCategory;
  textSample: string;
  pageCount: number;
  readMode: PdfReadMode;
  pageImages?: StudentPdfPageImage[];
  rasterEngine?: string;
}

export interface MaterialPdfReport {
  pdfId: string;
  fileName: string;
  agent: "materials";
  subjects: string[];
  topics: string[];
  curriculum: ExamPrepCurriculum;
  curriculumRangeFrom: string;
  curriculumRangeTo: string;
  narrativeStyle: string;
  density: "düşük" | "orta" | "yüksek";
  importance: "düşük" | "orta" | "yüksek";
  estimatedQuestionCount: number;
  alsoHasQuestions: boolean;
  summary: string;
  transferredToQuestions: boolean;
  analysisMode: PdfReadMode;
  learningOutcomes: LearningOutcome[];
}

export interface QuestionPdfReport {
  pdfId: string;
  fileName: string;
  agent: "questions";
  questionCountEstimate: number;
  questionTypes: string[];
  difficultyEasyPct: number;
  difficultyMediumPct: number;
  difficultyHardPct: number;
  topicsCovered: string[];
  alsoHasTopicContent: boolean;
  summary: string;
  transferredToMaterials: boolean;
  analysisMode: PdfReadMode;
  learningOutcomes: LearningOutcome[];
}

export interface CurriculumPdfReport {
  pdfId: string;
  fileName: string;
  agent: "curriculum";
  subjects: string[];
  units: string[];
  curriculum: ExamPrepCurriculum;
  curriculumRangeFrom: string;
  curriculumRangeTo: string;
  gradeLevel: string;
  totalOutcomeEstimate: number;
  learningOutcomes: LearningOutcome[];
  summary: string;
  analysisMode: PdfReadMode;
}

export interface ExamPrepGraphState {
  examGoal: string;
  curriculum: ExamPrepCurriculum | null;
  subject: string | null;
  pdfs: StudentPdfInput[];
  materialReports: MaterialPdfReport[];
  questionReports: QuestionPdfReport[];
  curriculumReports: CurriculumPdfReport[];
  transferred: Record<string, TransferDirection>;
  supervisorSummary: string;
  steps: string[];
  error: string | null;
}

export interface ExamPrepRunInput {
  examGoal: string;
  curriculum?: ExamPrepCurriculum | null;
  subject?: string | null;
  pdfs: StudentPdfInput[];
  pdfBuffers?: Map<string, Buffer>;
  ownerUserId?: string | null;
  onProgress?: ProgressCallback;
}

export interface ExamPrepRunResult {
  examGoal: string;
  curriculum: ExamPrepCurriculum | null;
  subject: string | null;
  supervisorSummary: string;
  materialReports: MaterialPdfReport[];
  questionReports: QuestionPdfReport[];
  curriculumReports: CurriculumPdfReport[];
  kazanımAlignment: KazanımAlignmentResult | null;
  persistence: ExamPrepPersistenceResult | null;
  steps: string[];
}
