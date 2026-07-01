import { getAgentOpenAI } from "@/lib/agents/clients";
import { AGENT_CHAT_MODEL } from "@/lib/agents/config";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import {
  EXAM_PREP_SUPERVISOR_SYSTEM,
  buildSupervisorUserPrompt,
} from "@/lib/agents/exam_prep/prompts/supervisor";
import type {
  CurriculumPdfReport,
  ExamPrepCurriculum,
  KazanımAlignmentResult,
  MaterialPdfReport,
  QuestionPdfReport,
} from "@/lib/agents/exam_prep/types";

function formatAlignmentForPrompt(
  alignment: KazanımAlignmentResult | null,
): string {
  if (!alignment) {
    return "Hesaplanamadı — hem konu hem soru PDF'i gerekli.";
  }

  return JSON.stringify(
    {
      genelUyumYuzdesi: alignment.overallAlignmentPct,
      soruKazanımKapsamaYuzdesi: alignment.questionCoveragePct,
      anlatimKazanımKarsilamaYuzdesi: alignment.materialCoveragePct,
      eslesenCiftSayisi: alignment.matchedCount,
      toplamSoruKazanımi: alignment.totalQuestionOutcomes,
      toplamAnlatimKazanımi: alignment.totalMaterialOutcomes,
      eslesmeyenSoruKazanımlari: alignment.unmatchedQuestionOutcomes.slice(0, 8),
      eslesmeyenAnlatimKazanımlari: alignment.unmatchedMaterialOutcomes.slice(0, 8),
      eslesenOrnekler: alignment.matchedPairs.slice(0, 5).map((pair) => ({
        soru: pair.questionOutcome.title,
        anlatim: pair.materialOutcome.title,
        benzerlik: Math.round(pair.similarity * 100),
      })),
    },
    null,
    2,
  );
}

export async function runExamPrepSupervisor(options: {
  examGoal: string;
  curriculum: ExamPrepCurriculum | null;
  subject: string | null;
  materialReports: MaterialPdfReport[];
  questionReports: QuestionPdfReport[];
  curriculumReports: CurriculumPdfReport[];
  kazanımAlignment: KazanımAlignmentResult | null;
}): Promise<string> {
  const openai = getAgentOpenAI();

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      AGENT_CHAT_MODEL,
      [
        { role: "system", content: EXAM_PREP_SUPERVISOR_SYSTEM },
        {
          role: "user",
          content: buildSupervisorUserPrompt({
            examGoal: options.examGoal,
            curriculum: options.curriculum,
            subject: options.subject,
            alignmentJson: formatAlignmentForPrompt(options.kazanımAlignment),
            materialReportsJson: JSON.stringify(
              options.materialReports,
              null,
              2,
            ),
            questionReportsJson: JSON.stringify(
              options.questionReports,
              null,
              2,
            ),
            curriculumReportsJson: JSON.stringify(
              options.curriculumReports,
              null,
              2,
            ),
          }),
        },
      ],
      { temperature: 0.25 },
    ),
  );

  const summary = completion.choices[0]?.message?.content?.trim();
  if (!summary) {
    throw new Error("Supervisor özeti üretilemedi.");
  }

  return summary;
}
