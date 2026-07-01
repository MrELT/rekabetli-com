import { runCurriculumAgent } from "@/lib/agents/exam_prep/nodes/curriculum-agent";
import { runMaterialsAgent } from "@/lib/agents/exam_prep/nodes/materials-agent";
import { runQuestionsAgent } from "@/lib/agents/exam_prep/nodes/questions-agent";
import { runExamPrepSupervisor } from "@/lib/agents/exam_prep/nodes/supervisor-synthesize";
import {
  collectMaterialOutcomes,
  collectQuestionOutcomes,
  computeKazanımAlignment,
} from "@/lib/agents/exam_prep/alignment";
import { runExamPrepPersistence } from "@/lib/agents/exam_prep/persistence/run-persistence";
import { getAgentOpenAI } from "@/lib/agents/clients";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { emitExamPrepProgress } from "@/lib/exam-prep/progress";
import type {
  ExamPrepRunInput,
  ExamPrepRunResult,
  MaterialPdfReport,
  QuestionPdfReport,
  StudentPdfInput,
  TransferDirection,
} from "@/lib/agents/exam_prep/types";

const STEP_INIT = "supervisor_init";
const STEP_MATERIALS = "materials_agent";
const STEP_QUESTIONS = "questions_agent";
const STEP_CURRICULUM = "curriculum_agent";
const STEP_CROSS_TRANSFER = "cross_transfer";
const STEP_ALIGNMENT = "alignment_scoring";
const STEP_PERSISTENCE = "persistence_agent";
const STEP_SUPERVISOR = "supervisor_synthesize";

function buildInitialQueues(pdfs: StudentPdfInput[]): {
  materialIds: string[];
  questionIds: string[];
  curriculumIds: string[];
} {
  const materialIds: string[] = [];
  const questionIds: string[] = [];
  const curriculumIds: string[] = [];

  for (const pdf of pdfs) {
    if (pdf.category === "material") {
      materialIds.push(pdf.id);
    } else if (pdf.category === "question") {
      questionIds.push(pdf.id);
    } else if (pdf.category === "curriculum") {
      curriculumIds.push(pdf.id);
    }
  }

  return { materialIds, questionIds, curriculumIds };
}

/**
 * Sınav hazırlık multi-agent grafiği (eski not üretim grafiği askıda).
 *
 * supervisor_init → materials_agent → questions_agent → curriculum_agent
 * → cross_transfer → persistence_agent → alignment_scoring → supervisor_synthesize
 */
export async function runExamPrepGraph(
  input: ExamPrepRunInput,
): Promise<ExamPrepRunResult> {
  const steps: string[] = [STEP_INIT];

  if (!input.pdfs.length) {
    throw new Error("En az bir PDF yükleyin.");
  }

  const examGoal = input.examGoal.trim() || "YKS sınav hazırlığı";
  const curriculum = input.curriculum ?? null;
  const subject = input.subject?.trim() || null;
  const transferred: Record<string, TransferDirection> = {};
  const crossTransferIds = new Set<string>();

  const { materialIds, questionIds, curriculumIds } = buildInitialQueues(input.pdfs);

  const agentContext = {
    pdfs: input.pdfs,
    examGoal,
    curriculum,
    subject,
  };

  emitExamPrepProgress(input.onProgress, STEP_INIT);

  let materialReports = await runMaterialsAgent({
    ...agentContext,
    pdfIds: materialIds,
    existingReports: [],
    crossTransferIds,
  });
  steps.push(STEP_MATERIALS);
  emitExamPrepProgress(input.onProgress, STEP_MATERIALS);

  let questionReports = await runQuestionsAgent({
    ...agentContext,
    pdfIds: questionIds,
    existingReports: [],
    crossTransferIds,
  });
  steps.push(STEP_QUESTIONS);
  emitExamPrepProgress(input.onProgress, STEP_QUESTIONS);

  const curriculumReports = await runCurriculumAgent({
    ...agentContext,
    pdfIds: curriculumIds,
    existingReports: [],
  });
  if (curriculumIds.length) {
    steps.push(STEP_CURRICULUM);
    emitExamPrepProgress(input.onProgress, STEP_CURRICULUM);
  }

  const questionAnalyzed = new Set(questionReports.map((report) => report.pdfId));
  const materialAnalyzed = new Set(materialReports.map((report) => report.pdfId));

  const crossToQuestions: string[] = [];
  for (const report of materialReports) {
    if (!report.alsoHasQuestions || transferred[report.pdfId]) continue;
    transferred[report.pdfId] = "to_questions";
    if (!questionAnalyzed.has(report.pdfId)) {
      crossToQuestions.push(report.pdfId);
    }
  }

  const crossToMaterials: string[] = [];
  for (const report of questionReports) {
    if (!report.alsoHasTopicContent || transferred[report.pdfId]) continue;
    transferred[report.pdfId] = "to_materials";
    if (!materialAnalyzed.has(report.pdfId)) {
      crossToMaterials.push(report.pdfId);
    }
  }

  if (crossToQuestions.length || crossToMaterials.length) {
    steps.push(STEP_CROSS_TRANSFER);
    emitExamPrepProgress(input.onProgress, STEP_CROSS_TRANSFER);
  }

  if (crossToQuestions.length) {
    for (const pdfId of crossToQuestions) {
      crossTransferIds.add(pdfId);
    }
    questionReports = await runQuestionsAgent({
      ...agentContext,
      pdfIds: crossToQuestions,
      existingReports: questionReports,
      crossTransferIds,
    });
    steps.push(`${STEP_QUESTIONS}_cross`);
    emitExamPrepProgress(input.onProgress, `${STEP_QUESTIONS}_cross`);
  }

  if (crossToMaterials.length) {
    for (const pdfId of crossToMaterials) {
      crossTransferIds.add(pdfId);
    }
    materialReports = await runMaterialsAgent({
      ...agentContext,
      pdfIds: crossToMaterials,
      existingReports: materialReports,
      crossTransferIds,
    });
    steps.push(`${STEP_MATERIALS}_cross`);
    emitExamPrepProgress(input.onProgress, `${STEP_MATERIALS}_cross`);
  }

  for (const report of materialReports) {
    if (transferred[report.pdfId] === "to_questions") {
      report.transferredToQuestions = true;
    }
  }
  for (const report of questionReports) {
    if (transferred[report.pdfId] === "to_materials") {
      report.transferredToMaterials = true;
    }
  }

  emitExamPrepProgress(input.onProgress, STEP_PERSISTENCE);

  const persistence = await runExamPrepPersistence({
    pdfs: input.pdfs,
    pdfBuffers: input.pdfBuffers ?? new Map(),
    materialReports,
    questionReports,
    curriculumReports,
    ownerUserId: input.ownerUserId ?? "anonymous",
    examGoal,
    curriculum,
    subject,
    supabase: createSupabaseServerClient(),
  });
  if (persistence.enabled && persistence.pdfs.length) {
    steps.push(STEP_PERSISTENCE);
  }

  const materialOutcomes = collectMaterialOutcomes(materialReports);
  const questionOutcomes = collectQuestionOutcomes(questionReports);

  let kazanımAlignment = null;
  if (materialOutcomes.length && questionOutcomes.length) {
    emitExamPrepProgress(input.onProgress, STEP_ALIGNMENT);
    kazanımAlignment = await computeKazanımAlignment(
      getAgentOpenAI(),
      materialOutcomes,
      questionOutcomes,
    );
    steps.push(STEP_ALIGNMENT);
  }

  emitExamPrepProgress(input.onProgress, STEP_SUPERVISOR);
  const supervisorSummary = await runExamPrepSupervisor({
    examGoal,
    curriculum,
    subject,
    materialReports,
    questionReports,
    curriculumReports,
    kazanımAlignment,
  });
  steps.push(STEP_SUPERVISOR);

  return {
    examGoal,
    curriculum,
    subject,
    supervisorSummary,
    materialReports,
    questionReports,
    curriculumReports,
    kazanımAlignment,
    persistence,
    steps,
  };
}
