export interface ProgressUpdate {
  step: string;
  label: string;
  percent: number;
  detail?: string;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

const EXAM_PREP_PIPELINE = [
  "pdf_prepare",
  "supervisor_init",
  "materials_agent",
  "questions_agent",
  "curriculum_agent",
  "cross_transfer",
  "questions_agent_cross",
  "materials_agent_cross",
  "persistence_agent",
  "alignment_scoring",
  "supervisor_synthesize",
] as const;

export const EXAM_PREP_STEP_LABELS: Record<string, string> = {
  pdf_prepare: "PDF dosyaları hazırlanıyor",
  supervisor_init: "Supervisor başlatılıyor",
  materials_agent: "Konu anlatımı PDF'leri analiz ediliyor",
  questions_agent: "Soru PDF'leri analiz ediliyor",
  curriculum_agent: "Müfredat PDF'leri analiz ediliyor",
  cross_transfer: "Çapraz aktarım değerlendiriliyor",
  questions_agent_cross: "Ek soru analizi (çapraz aktarım)",
  materials_agent_cross: "Ek konu analizi (çapraz aktarım)",
  persistence_agent: "Supabase'e kalıcı kayıt yapılıyor",
  alignment_scoring: "Kazanım uyumu hesaplanıyor",
  supervisor_synthesize: "Supervisor özeti oluşturuluyor",
};

const STUDY_PIPELINE = [
  "study_init",
  "study_retrieve",
  "study_note_draft",
  "study_supervisor_review",
  "study_note_revise",
] as const;

export const STUDY_STEP_LABELS: Record<string, string> = {
  study_init: "Çalışma kuyruğu oluşturuluyor",
  study_retrieve: "İlgili chunk ve görseller aranıyor",
  study_note_draft: "Konu notu yazılıyor",
  study_supervisor_review: "Supervisor notu inceliyor",
  study_note_revise: "Not revize ediliyor",
  study_cache_hit: "Önbellekten yüklendi",
};

function percentForStep(
  step: string,
  pipeline: readonly string[],
): number {
  const index = pipeline.indexOf(step);
  if (index < 0) return 8;
  return Math.min(99, Math.round(((index + 1) / pipeline.length) * 100));
}

export function getExamPrepStepLabel(step: string): string {
  return EXAM_PREP_STEP_LABELS[step] ?? step;
}

export function getExamPrepStepPercent(step: string): number {
  return percentForStep(step, EXAM_PREP_PIPELINE);
}

export function getStudyStepLabel(step: string): string {
  return STUDY_STEP_LABELS[step] ?? step;
}

export function getStudyStepPercent(step: string): number {
  return percentForStep(step, STUDY_PIPELINE);
}

export function emitExamPrepProgress(
  onProgress: ProgressCallback | undefined,
  step: string,
  detail?: string,
): void {
  onProgress?.({
    step,
    label: getExamPrepStepLabel(step),
    percent: getExamPrepStepPercent(step),
    detail,
  });
}

export function emitStudyProgress(
  onProgress: ProgressCallback | undefined,
  step: string,
  detail?: string,
): void {
  onProgress?.({
    step,
    label: getStudyStepLabel(step),
    percent: getStudyStepPercent(step),
    detail,
  });
}

export function buildStepStatuses(
  pipeline: readonly string[],
  labels: Record<string, string>,
  currentStep: string,
  completedSteps: string[],
): Array<{
  id: string;
  label: string;
  status: "done" | "active" | "pending";
}> {
  return pipeline.map((id) => ({
    id,
    label: labels[id] ?? id,
    status: completedSteps.includes(id)
      ? "done"
      : id === currentStep
        ? "active"
        : "pending",
  }));
}

export const EXAM_PREP_STATUS_PIPELINE = EXAM_PREP_PIPELINE;
export const STUDY_STATUS_PIPELINE = STUDY_PIPELINE;
