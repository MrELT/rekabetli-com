import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import { getAgentOpenAI } from "@/lib/agents/clients";
import {
  persistTextCurriculumPdf,
  persistTextMaterialPdf,
  persistTextQuestionPdf,
} from "@/lib/agents/exam_prep/persistence/persist-text";
import type { ExamPrepPersistenceResult } from "@/lib/agents/exam_prep/persistence/types";
import {
  runVisualAgentForCurriculum,
  runVisualAgentForMaterial,
  runVisualAgentForQuestions,
} from "@/lib/agents/exam_prep/persistence/visual-agent";
import type {
  CurriculumPdfReport,
  ExamPrepCurriculum,
  MaterialPdfReport,
  QuestionPdfReport,
  StudentPdfInput,
} from "@/lib/agents/exam_prep/types";
import { EXAM_PREP_PERSIST_MAX_PAGES } from "@/lib/exam-prep/constants";

export interface RunExamPrepPersistenceOptions {
  pdfs: StudentPdfInput[];
  pdfBuffers: Map<string, Buffer>;
  materialReports: MaterialPdfReport[];
  questionReports: QuestionPdfReport[];
  curriculumReports: CurriculumPdfReport[];
  ownerUserId: string;
  examGoal: string;
  curriculum: ExamPrepCurriculum | null;
  subject: string | null;
  supabase: SupabaseClient | null;
  openai?: OpenAI;
}

function shouldPersistAsMaterial(
  pdf: StudentPdfInput,
  materialReports: MaterialPdfReport[],
  questionReports: QuestionPdfReport[],
): boolean {
  if (pdf.category === "material") return true;
  const report = questionReports.find((item) => item.pdfId === pdf.id);
  return Boolean(report?.transferredToMaterials);
}

function shouldPersistAsQuestion(
  pdf: StudentPdfInput,
  materialReports: MaterialPdfReport[],
  questionReports: QuestionPdfReport[],
): boolean {
  if (pdf.category === "question") return true;
  const report = materialReports.find((item) => item.pdfId === pdf.id);
  return Boolean(report?.transferredToQuestions);
}

function getMaterialHints(pdfId: string, reports: MaterialPdfReport[]) {
  const report = reports.find((item) => item.pdfId === pdfId);
  return {
    hintOutcomes: report?.learningOutcomes ?? [],
    hintCurriculum: report?.curriculum ?? null,
    hintSubject: report?.subjects[0] ?? null,
  };
}

function getQuestionHints(pdfId: string, reports: QuestionPdfReport[]) {
  const report = reports.find((item) => item.pdfId === pdfId);
  return {
    hintOutcomes: report?.learningOutcomes ?? [],
    hintCurriculum: null as ExamPrepCurriculum | null,
    hintSubject: report?.topicsCovered[0] ?? null,
  };
}

function getCurriculumHints(pdfId: string, reports: CurriculumPdfReport[]) {
  const report = reports.find((item) => item.pdfId === pdfId);
  return {
    hintOutcomes: report?.learningOutcomes ?? [],
    hintCurriculum: report?.curriculum ?? null,
    hintSubject: report?.subjects[0] ?? null,
  };
}

/**
 * Çapraz aktarım sonrası konu/soru/müfredat PDF'lerini Supabase'e yazar.
 * Metin → chunk + zengin metadata; taranmış soru → görsel agent kutula/kes;
 * taranmış konu → görsel agent OCR + chunk.
 */
export async function runExamPrepPersistence(
  options: RunExamPrepPersistenceOptions,
): Promise<ExamPrepPersistenceResult> {
  if (!options.supabase) {
    return {
      enabled: false,
      pdfs: [],
      totalChunks: 0,
      totalFigures: 0,
      errors: ["Supabase yapılandırması eksik — kalıcı kayıt atlandı."],
    };
  }

  const openai = options.openai ?? getAgentOpenAI();
  const pdfStats: ExamPrepPersistenceResult["pdfs"] = [];
  const globalErrors: string[] = [];

  for (const pdf of options.pdfs) {
    const buffer = options.pdfBuffers.get(pdf.id);
    if (!buffer?.length) {
      globalErrors.push(`${pdf.fileName}: PDF buffer bulunamadı.`);
      continue;
    }

    const persistMaterial = shouldPersistAsMaterial(
      pdf,
      options.materialReports,
      options.questionReports,
    );
    const persistQuestion = shouldPersistAsQuestion(
      pdf,
      options.materialReports,
      options.questionReports,
    );

    const sharedHints = {
      ownerUserId: options.ownerUserId,
      examGoal: options.examGoal,
      hintSubject: options.subject,
      hintCurriculum: options.curriculum,
    };

    if (persistMaterial) {
      const materialHints = getMaterialHints(pdf.id, options.materialReports);

      try {
        const stats =
          pdf.readMode === "vision"
            ? await runVisualAgentForMaterial(options.supabase, openai, {
                pdf,
                ...sharedHints,
                hintSubject: materialHints.hintSubject ?? sharedHints.hintSubject,
                hintCurriculum:
                  materialHints.hintCurriculum ?? sharedHints.hintCurriculum,
                hintOutcomes: materialHints.hintOutcomes,
              })
            : await persistTextMaterialPdf(options.supabase, openai, {
                pdf,
                buffer,
                maxPages: EXAM_PREP_PERSIST_MAX_PAGES,
                ...sharedHints,
                hintSubject: materialHints.hintSubject ?? sharedHints.hintSubject,
                hintCurriculum:
                  materialHints.hintCurriculum ?? sharedHints.hintCurriculum,
                hintOutcomes: materialHints.hintOutcomes,
              });

        pdfStats.push(stats);
      } catch (error) {
        globalErrors.push(
          error instanceof Error
            ? `${pdf.fileName} (konu): ${error.message}`
            : `${pdf.fileName} (konu): kayıt hatası`,
        );
      }
    }

    if (persistQuestion) {
      const questionHints = getQuestionHints(pdf.id, options.questionReports);

      try {
        const stats =
          pdf.readMode === "vision"
            ? await runVisualAgentForQuestions(options.supabase, openai, {
                pdf,
                ...sharedHints,
                hintSubject: questionHints.hintSubject ?? sharedHints.hintSubject,
                hintCurriculum:
                  questionHints.hintCurriculum ?? sharedHints.hintCurriculum,
                hintOutcomes: questionHints.hintOutcomes,
              })
            : await persistTextQuestionPdf(options.supabase, openai, {
                pdf,
                buffer,
                maxPages: EXAM_PREP_PERSIST_MAX_PAGES,
                ...sharedHints,
                hintSubject: questionHints.hintSubject ?? sharedHints.hintSubject,
                hintCurriculum:
                  questionHints.hintCurriculum ?? sharedHints.hintCurriculum,
                hintOutcomes: questionHints.hintOutcomes,
              });

        pdfStats.push(stats);
      } catch (error) {
        globalErrors.push(
          error instanceof Error
            ? `${pdf.fileName} (soru): ${error.message}`
            : `${pdf.fileName} (soru): kayıt hatası`,
        );
      }
    }

    if (pdf.category === "curriculum") {
      const curriculumHints = getCurriculumHints(
        pdf.id,
        options.curriculumReports,
      );

      try {
        const stats =
          pdf.readMode === "vision"
            ? await runVisualAgentForCurriculum(options.supabase, openai, {
                pdf,
                ...sharedHints,
                hintSubject:
                  curriculumHints.hintSubject ?? sharedHints.hintSubject,
                hintCurriculum:
                  curriculumHints.hintCurriculum ?? sharedHints.hintCurriculum,
                hintOutcomes: curriculumHints.hintOutcomes,
              })
            : await persistTextCurriculumPdf(options.supabase, openai, {
                pdf,
                buffer,
                maxPages: EXAM_PREP_PERSIST_MAX_PAGES,
                ...sharedHints,
                hintSubject:
                  curriculumHints.hintSubject ?? sharedHints.hintSubject,
                hintCurriculum:
                  curriculumHints.hintCurriculum ?? sharedHints.hintCurriculum,
                hintOutcomes: curriculumHints.hintOutcomes,
              });

        pdfStats.push(stats);
      } catch (error) {
        globalErrors.push(
          error instanceof Error
            ? `${pdf.fileName} (müfredat): ${error.message}`
            : `${pdf.fileName} (müfredat): kayıt hatası`,
        );
      }
    }
  }

  return {
    enabled: true,
    pdfs: pdfStats,
    totalChunks: pdfStats.reduce((sum, item) => sum + item.storedChunks, 0),
    totalFigures: pdfStats.reduce((sum, item) => sum + item.storedFigures, 0),
    errors: [...globalErrors, ...pdfStats.flatMap((item) => item.errors)],
  };
}
