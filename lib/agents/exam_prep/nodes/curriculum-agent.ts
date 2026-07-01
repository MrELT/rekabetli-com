import { getAgentOpenAI } from "@/lib/agents/clients";
import { AGENT_CHAT_MODEL } from "@/lib/agents/config";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import { parseLearningOutcomes } from "@/lib/agents/exam_prep/alignment";
import {
  CURRICULUM_AGENT_SYSTEM,
  buildCurriculumUserPrompt,
} from "@/lib/agents/exam_prep/prompts/curriculum";
import { runVisionJsonAnalysis } from "@/lib/agents/exam_prep/vision-analyze";
import type {
  CurriculumPdfReport,
  ExamPrepCurriculum,
  StudentPdfInput,
} from "@/lib/agents/exam_prep/types";

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Müfredat ajanı JSON yanıtı geçersiz.");
  }
}

function normalizeCurriculum(value: unknown): ExamPrepCurriculum {
  const raw = String(value ?? "genel").toUpperCase();
  if (raw.includes("TYT")) return "TYT";
  if (raw.includes("AYT")) return "AYT";
  return "genel";
}

function parseCurriculumReport(
  raw: unknown,
  pdf: StudentPdfInput,
): CurriculumPdfReport {
  const record =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return {
    pdfId: pdf.id,
    fileName: pdf.fileName,
    agent: "curriculum",
    subjects: Array.isArray(record.subjects)
      ? record.subjects.map((s) => String(s).trim()).filter(Boolean)
      : [],
    units: Array.isArray(record.units)
      ? record.units.map((u) => String(u).trim()).filter(Boolean)
      : [],
    curriculum: normalizeCurriculum(record.curriculum),
    curriculumRangeFrom: String(record.curriculum_range_from ?? "").trim(),
    curriculumRangeTo: String(record.curriculum_range_to ?? "").trim(),
    gradeLevel: String(record.grade_level ?? "belirsiz").trim(),
    totalOutcomeEstimate: Number(record.total_outcome_estimate ?? 0) || 0,
    learningOutcomes: parseLearningOutcomes(record.learning_outcomes),
    summary:
      String(record.summary ?? "").trim() ||
      `${pdf.fileName} sınav müfredatı belgesi.`,
    analysisMode: pdf.readMode,
  };
}

export async function analyzeCurriculumPdf(
  pdf: StudentPdfInput,
  context: {
    examGoal: string;
    curriculum: ExamPrepCurriculum | null;
    subject: string | null;
  },
): Promise<CurriculumPdfReport> {
  const promptOptions = {
    fileName: pdf.fileName,
    examGoal: context.examGoal,
    curriculum: context.curriculum,
    subject: context.subject,
    textSample: pdf.textSample,
    pageCount: pdf.pageCount,
    isVisionMode: pdf.readMode === "vision",
  };

  if (pdf.readMode === "vision" && pdf.pageImages?.length) {
    const raw = await runVisionJsonAnalysis({
      systemPrompt: CURRICULUM_AGENT_SYSTEM,
      userText: buildCurriculumUserPrompt(promptOptions),
      pageImages: pdf.pageImages,
    });
    return parseCurriculumReport(raw, pdf);
  }

  const openai = getAgentOpenAI();
  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      AGENT_CHAT_MODEL,
      [
        { role: "system", content: CURRICULUM_AGENT_SYSTEM },
        { role: "user", content: buildCurriculumUserPrompt(promptOptions) },
      ],
      { temperature: 0.15, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Müfredat ajanı boş yanıt döndü.");
  }

  return parseCurriculumReport(extractJson(rawText), pdf);
}

export async function runCurriculumAgent(options: {
  pdfs: StudentPdfInput[];
  pdfIds: string[];
  examGoal: string;
  curriculum: ExamPrepCurriculum | null;
  subject: string | null;
  existingReports: CurriculumPdfReport[];
}): Promise<CurriculumPdfReport[]> {
  const reports = [...options.existingReports];
  const analyzed = new Set(reports.map((report) => report.pdfId));

  for (const pdfId of options.pdfIds) {
    if (analyzed.has(pdfId)) continue;

    const pdf = options.pdfs.find((item) => item.id === pdfId);
    if (!pdf) continue;

    const report = await analyzeCurriculumPdf(pdf, {
      examGoal: options.examGoal,
      curriculum: options.curriculum,
      subject: options.subject,
    });

    reports.push(report);
    analyzed.add(pdfId);
  }

  return reports;
}
