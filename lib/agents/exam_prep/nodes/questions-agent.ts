import { getAgentOpenAI } from "@/lib/agents/clients";
import { AGENT_CHAT_MODEL } from "@/lib/agents/config";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import {
  QUESTIONS_AGENT_SYSTEM,
  buildQuestionsUserPrompt,
} from "@/lib/agents/exam_prep/prompts/questions";
import { runVisionJsonAnalysis } from "@/lib/agents/exam_prep/vision-analyze";
import { parseLearningOutcomes } from "@/lib/agents/exam_prep/alignment";
import type {
  ExamPrepCurriculum,
  QuestionPdfReport,
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
    throw new Error("Soru ajanı JSON yanıtı geçersiz.");
  }
}

function parseQuestionReport(
  raw: unknown,
  pdf: StudentPdfInput,
  isCrossTransfer: boolean,
): QuestionPdfReport {
  const record =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const easy = Number(record.difficulty_easy_pct ?? 0) || 0;
  const medium = Number(record.difficulty_medium_pct ?? 0) || 0;
  const hard = Number(record.difficulty_hard_pct ?? 0) || 0;

  return {
    pdfId: pdf.id,
    fileName: pdf.fileName,
    agent: "questions",
    questionCountEstimate: Number(record.question_count_estimate ?? 0) || 0,
    questionTypes: Array.isArray(record.question_types)
      ? record.question_types.map((t) => String(t).trim()).filter(Boolean)
      : [],
    difficultyEasyPct: easy,
    difficultyMediumPct: medium,
    difficultyHardPct: hard,
    topicsCovered: Array.isArray(record.topics_covered)
      ? record.topics_covered.map((t) => String(t).trim()).filter(Boolean)
      : [],
    alsoHasTopicContent: Boolean(record.also_has_topic_content),
    summary: String(record.summary ?? "").trim() || `${pdf.fileName} soru kaynağı.`,
    transferredToMaterials: isCrossTransfer,
    analysisMode: pdf.readMode,
    learningOutcomes: parseLearningOutcomes(record.learning_outcomes),
  };
}

export async function analyzeQuestionPdf(
  pdf: StudentPdfInput,
  context: {
    examGoal: string;
    curriculum: ExamPrepCurriculum | null;
    subject: string | null;
    isCrossTransfer: boolean;
  },
): Promise<QuestionPdfReport> {
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
      systemPrompt: QUESTIONS_AGENT_SYSTEM,
      userText: buildQuestionsUserPrompt(promptOptions),
      pageImages: pdf.pageImages,
    });
    return parseQuestionReport(raw, pdf, context.isCrossTransfer);
  }

  const openai = getAgentOpenAI();

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      AGENT_CHAT_MODEL,
      [
        { role: "system", content: QUESTIONS_AGENT_SYSTEM },
        {
          role: "user",
          content: buildQuestionsUserPrompt(promptOptions),
        },
      ],
      { temperature: 0.15, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Soru ajanı boş yanıt döndü.");
  }

  return parseQuestionReport(extractJson(rawText), pdf, context.isCrossTransfer);
}

export async function runQuestionsAgent(options: {
  pdfs: StudentPdfInput[];
  pdfIds: string[];
  examGoal: string;
  curriculum: ExamPrepCurriculum | null;
  subject: string | null;
  existingReports: QuestionPdfReport[];
  crossTransferIds: Set<string>;
}): Promise<QuestionPdfReport[]> {
  const reports = [...options.existingReports];
  const analyzed = new Set(reports.map((report) => report.pdfId));

  for (const pdfId of options.pdfIds) {
    if (analyzed.has(pdfId)) continue;

    const pdf = options.pdfs.find((item) => item.id === pdfId);
    if (!pdf) continue;

    const isCrossTransfer = options.crossTransferIds.has(pdfId);
    const report = await analyzeQuestionPdf(pdf, {
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
