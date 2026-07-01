import { randomUUID } from "node:crypto";

import { prepareStudentPdfFromBuffer } from "@/lib/agents/exam_prep/pdf-prepare";
import { runExamPrepGraph } from "@/lib/agents/exam_prep/run";
import type {
  ExamPrepCurriculum,
  ExamPrepRunResult,
  StudentPdfCategory,
  StudentPdfInput,
} from "@/lib/agents/exam_prep/types";
import {
  EXAM_PREP_MAX_FILE_BYTES,
  EXAM_PREP_MAX_FILES_PER_CATEGORY,
} from "@/lib/exam-prep/constants";
import {
  emitExamPrepProgress,
  type ProgressCallback,
} from "@/lib/exam-prep/progress";

function isPdfFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith(".pdf") &&
    (file.type === "application/pdf" || !file.type)
  );
}

async function collectPdfInputs(
  formData: FormData,
  fieldName: string,
  category: StudentPdfCategory,
  onProgress?: ProgressCallback,
): Promise<{
  pdfs: StudentPdfInput[];
  buffers: Map<string, Buffer>;
  errors: string[];
}> {
  const entries = formData.getAll(fieldName).filter((entry) => entry instanceof File);
  const pdfs: StudentPdfInput[] = [];
  const buffers = new Map<string, Buffer>();
  const errors: string[] = [];

  if (entries.length > EXAM_PREP_MAX_FILES_PER_CATEGORY) {
    errors.push(
      `${fieldName}: en fazla ${EXAM_PREP_MAX_FILES_PER_CATEGORY} PDF yüklenebilir.`,
    );
    return { pdfs, buffers, errors };
  }

  for (let index = 0; index < entries.length; index++) {
    const file = entries[index] as File;
    if (!isPdfFile(file)) {
      errors.push(`${file.name}: yalnızca PDF kabul edilir.`);
      continue;
    }
    if (file.size > EXAM_PREP_MAX_FILE_BYTES) {
      errors.push(`${file.name}: dosya boyutu en fazla 15 MB olabilir.`);
      continue;
    }

    emitExamPrepProgress(onProgress, "pdf_prepare", file.name);

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const pdfId = randomUUID();
      const pdf = await prepareStudentPdfFromBuffer(
        buffer,
        file.name,
        category,
        pdfId,
      );
      buffers.set(pdf.id, buffer);
      pdfs.push(pdf);
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `${file.name}: ${error.message}`
          : `${file.name}: işlenemedi.`,
      );
    }
  }

  return { pdfs, buffers, errors };
}

export interface ExecuteExamPrepOptions {
  formData: FormData;
  ownerUserId: string;
  curriculum: ExamPrepCurriculum | null;
  onProgress?: ProgressCallback;
}

export interface ExecuteExamPrepResponse {
  result: ExamPrepRunResult;
  ingestErrors: string[];
  visionPdfCount: number;
}

export async function executeExamPrepAnalysis(
  options: ExecuteExamPrepOptions,
): Promise<ExecuteExamPrepResponse> {
  const { formData, ownerUserId, curriculum, onProgress } = options;

  const examGoal =
    typeof formData.get("examGoal") === "string"
      ? String(formData.get("examGoal")).trim()
      : "";
  const subject =
    typeof formData.get("subject") === "string"
      ? String(formData.get("subject")).trim()
      : "";

  emitExamPrepProgress(onProgress, "pdf_prepare");

  const [materials, questions, curricula] = await Promise.all([
    collectPdfInputs(formData, "materialPdfs", "material", onProgress),
    collectPdfInputs(formData, "questionPdfs", "question", onProgress),
    collectPdfInputs(formData, "curriculumPdfs", "curriculum", onProgress),
  ]);

  const ingestErrors = [
    ...materials.errors,
    ...questions.errors,
    ...curricula.errors,
  ];
  const pdfs = [...materials.pdfs, ...questions.pdfs, ...curricula.pdfs];
  const pdfBuffers = new Map([
    ...materials.buffers,
    ...questions.buffers,
    ...curricula.buffers,
  ]);

  if (!pdfs.length) {
    throw new Error(
      ingestErrors[0] ??
        "En az bir geçerli PDF yükleyin (konu anlatımı veya soru).",
    );
  }

  const result = await runExamPrepGraph({
    examGoal: examGoal || "YKS sınav hazırlığı",
    curriculum,
    subject: subject || null,
    pdfs,
    pdfBuffers,
    ownerUserId,
    onProgress,
  });

  return {
    result,
    ingestErrors,
    visionPdfCount: pdfs.filter((pdf) => pdf.readMode === "vision").length,
  };
}
