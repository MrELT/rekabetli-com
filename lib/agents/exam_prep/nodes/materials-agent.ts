import { getAgentOpenAI } from "@/lib/agents/clients";
import { AGENT_CHAT_MODEL } from "@/lib/agents/config";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import {
  MATERIALS_AGENT_SYSTEM,
  buildMaterialsUserPrompt,
} from "@/lib/agents/exam_prep/prompts/materials";
import { runVisionJsonAnalysis } from "@/lib/agents/exam_prep/vision-analyze";
import { parseLearningOutcomes } from "@/lib/agents/exam_prep/alignment";
import type {
  ExamPrepCurriculum,
  MaterialPdfReport,
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
    throw new Error("Kaynak ajanı JSON yanıtı geçersiz.");
  }
}

function normalizeDensity(value: unknown): "düşük" | "orta" | "yüksek" {
  const raw = String(value ?? "orta").toLowerCase();
  if (raw.includes("düşük") || raw.includes("low")) return "düşük";
  if (raw.includes("yüksek") || raw.includes("high")) return "yüksek";
  return "orta";
}

function normalizeCurriculum(value: unknown): ExamPrepCurriculum {
  const raw = String(value ?? "genel").toUpperCase();
  if (raw.includes("TYT")) return "TYT";
  if (raw.includes("AYT")) return "AYT";
  return "genel";
}

function parseMaterialReport(
  raw: unknown,
  pdf: StudentPdfInput,
  isCrossTransfer: boolean,
): MaterialPdfReport {
  const record =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return {
    pdfId: pdf.id,
    fileName: pdf.fileName,
    agent: "materials",
    subjects: Array.isArray(record.subjects)
      ? record.subjects.map((s) => String(s).trim()).filter(Boolean)
      : [],
    topics: Array.isArray(record.topics)
      ? record.topics.map((t) => String(t).trim()).filter(Boolean)
      : [],
    curriculum: normalizeCurriculum(record.curriculum),
    curriculumRangeFrom: String(record.curriculum_range_from ?? "").trim(),
    curriculumRangeTo: String(record.curriculum_range_to ?? "").trim(),
    narrativeStyle: String(record.narrative_style ?? "").trim(),
    density: normalizeDensity(record.density),
    importance: normalizeDensity(record.importance),
    estimatedQuestionCount: Number(record.estimated_question_count ?? 0) || 0,
    alsoHasQuestions: Boolean(record.also_has_questions),
    summary: String(record.summary ?? "").trim() || `${pdf.fileName} konu kaynağı.`,
    transferredToQuestions: isCrossTransfer,
    analysisMode: pdf.readMode,
    learningOutcomes: parseLearningOutcomes(record.learning_outcomes),
  };
}

export async function analyzeMaterialPdf(
  pdf: StudentPdfInput,
  context: {
    examGoal: string;
    curriculum: ExamPrepCurriculum | null;
    subject: string | null;
    isCrossTransfer: boolean;
  },
): Promise<MaterialPdfReport> {
  const promptOptions = {
    fileName: pdf.fileName,
    examGoal: context.examGoal,
    curriculum: context.curriculum,
    subject: context.subject,
    textSample: pdf.textSample,
    pageCount: pdf.pageCount,
    isCrossTransfer: context.isCrossTransfer,
    isVisionMode: pdf.readMode === "vision",
  };

  if (pdf.readMode === "vision" && pdf.pageImages?.length) {
    const raw = await runVisionJsonAnalysis({
      systemPrompt: MATERIALS_AGENT_SYSTEM,
      userText: buildMaterialsUserPrompt(promptOptions),
      pageImages: pdf.pageImages,
    });
    return parseMaterialReport(raw, pdf, context.isCrossTransfer);
  }

  const openai = getAgentOpenAI();

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      AGENT_CHAT_MODEL,
      [
        { role: "system", content: MATERIALS_AGENT_SYSTEM },
        {
          role: "user",
          content: buildMaterialsUserPrompt(promptOptions),
        },
      ],
      { temperature: 0.15, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Kaynak ajanı boş yanıt döndü.");
  }

  return parseMaterialReport(extractJson(rawText), pdf, context.isCrossTransfer);
}

export async function runMaterialsAgent(options: {
  pdfs: StudentPdfInput[];
  pdfIds: string[];
  examGoal: string;
  curriculum: ExamPrepCurriculum | null;
  subject: string | null;
  existingReports: MaterialPdfReport[];
  crossTransferIds: Set<string>;
}): Promise<MaterialPdfReport[]> {
  const reports = [...options.existingReports];
  const analyzed = new Set(reports.map((report) => report.pdfId));

  for (const pdfId of options.pdfIds) {
    if (analyzed.has(pdfId)) continue;

    const pdf = options.pdfs.find((item) => item.id === pdfId);
    if (!pdf) continue;

    const isCrossTransfer = options.crossTransferIds.has(pdfId);
    const report = await analyzeMaterialPdf(pdf, {
      examGoal: options.examGoal,
      curriculum: options.curriculum,
      subject: options.subject,
      isCrossTransfer,
    });

    reports.push(report);
    analyzed.add(pdfId);
  }

  return reports;
}
