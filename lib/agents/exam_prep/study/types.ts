import type { KazanımAlignmentResult, LearningOutcome } from "@/lib/agents/exam_prep/alignment-types";
import type {
  CurriculumPdfReport,
  ExamPrepCurriculum,
  MaterialPdfReport,
  QuestionPdfReport,
} from "@/lib/agents/exam_prep/types";

export interface StudyTopicItem {
  index: number;
  title: string;
  unit: string;
  briefing: string;
  learningOutcomes: LearningOutcome[];
  source: "curriculum" | "material";
  /** Alignment gap skoru — yüksek olan önce çalışılır */
  gapScore?: number;
}

export interface StudyInitInput {
  examGoal: string;
  curriculum: ExamPrepCurriculum | null;
  subject: string | null;
  materialReports: MaterialPdfReport[];
  questionReports: QuestionPdfReport[];
  curriculumReports: CurriculumPdfReport[];
  kazanımAlignment?: KazanımAlignmentResult | null;
  ownerUserId?: string;
}

export interface StudyInitResult {
  sessionId: string | null;
  topics: StudyTopicItem[];
  totalTopics: number;
  queueSource: "curriculum" | "material" | "fallback";
  sortedByAlignment: boolean;
}

export interface StudyTopicGenerateInput {
  ownerUserId: string;
  sessionId?: string | null;
  examGoal: string;
  curriculum: ExamPrepCurriculum | null;
  subject: string | null;
  topic: StudyTopicItem;
  topicIndex: number;
  totalTopics: number;
}

export interface StudyTopicGenerateResult {
  topicIndex: number;
  topicTitle: string;
  markdown: string;
  revised: boolean;
  steps: string[];
  cached?: boolean;
}

export interface StudyRetrievedContext {
  materialText: string;
  questionText: string;
  questionImagesMarkdown: string;
  materialChunkCount: number;
  questionChunkCount: number;
  figureCount: number;
}
