import {
  EXAM_PREP_MAX_VISION_PAGES,
  EXAM_PREP_PERSIST_MAX_PAGES,
} from "@/lib/exam-prep/constants";

/** Kabaca USD maliyet tahmini (gpt-4o-mini + embedding). */
const COST_PER_AGENT_CALL = 0.002;
const COST_PER_CHUNK_LABEL = 0.0015;
const COST_PER_VISION_PAGE = 0.008;
const COST_PER_STUDY_TOPIC = 0.025;

export interface ExamPrepEstimateInput {
  materialCount: number;
  questionCount: number;
  curriculumCount: number;
  visionPdfCount?: number;
  estimatedChunkCount?: number;
  studyTopicCount?: number;
}

export interface ExamPrepEstimate {
  analysisMinutes: number;
  studyMinutes: number;
  analysisCostUsd: number;
  studyCostUsd: number;
  totalCostUsd: number;
  warnings: string[];
}

export function estimateExamPrepAnalysis(
  input: ExamPrepEstimateInput,
): Pick<ExamPrepEstimate, "analysisMinutes" | "analysisCostUsd" | "warnings"> {
  const pdfCount =
    input.materialCount + input.questionCount + input.curriculumCount;
  const visionPages = (input.visionPdfCount ?? 0) * EXAM_PREP_MAX_VISION_PAGES;
  const chunkCount =
    input.estimatedChunkCount ??
    Math.min(pdfCount * 12, EXAM_PREP_PERSIST_MAX_PAGES);

  const agentCalls = pdfCount * 1.2 + 2;
  const labelCalls = chunkCount;
  const visionCalls = visionPages > 0 ? Math.ceil(visionPages / 6) : 0;

  const analysisCostUsd =
    agentCalls * COST_PER_AGENT_CALL +
    labelCalls * COST_PER_CHUNK_LABEL +
    visionCalls * COST_PER_VISION_PAGE;

  const analysisMinutes = Math.ceil(
    pdfCount * 0.8 + chunkCount * 0.15 + visionPages * 0.05 + 1,
  );

  const warnings: string[] = [];

  if (input.visionPdfCount && input.visionPdfCount > 0) {
    warnings.push(
      `${input.visionPdfCount} taranmış PDF için yalnızca ilk ${EXAM_PREP_MAX_VISION_PAGES} sayfa vision ile okunur.`,
    );
  }

  if (pdfCount > 4) {
    warnings.push(
      "Çok sayıda PDF analizi 3–5 dakikayı aşabilir; işlem arka planda devam eder.",
    );
  }

  if (chunkCount > 40) {
    warnings.push(
      `Kalıcı kayıt ~${chunkCount} chunk üretebilir; maliyet yükselir.`,
    );
  }

  return { analysisMinutes, analysisCostUsd, warnings };
}

export function estimateExamPrepStudy(
  topicCount: number,
): Pick<ExamPrepEstimate, "studyMinutes" | "studyCostUsd"> {
  const studyCostUsd = topicCount * COST_PER_STUDY_TOPIC;
  const studyMinutes = Math.ceil(topicCount * 0.75);
  return { studyMinutes, studyCostUsd };
}

export function estimateExamPrepFull(
  input: ExamPrepEstimateInput,
): ExamPrepEstimate {
  const analysis = estimateExamPrepAnalysis(input);
  const study = estimateExamPrepStudy(input.studyTopicCount ?? 10);

  return {
    ...analysis,
    ...study,
    totalCostUsd: analysis.analysisCostUsd + study.studyCostUsd,
  };
}

export function formatCostUsd(value: number): string {
  return value < 0.01 ? "<$0.01" : `~$${value.toFixed(2)}`;
}
