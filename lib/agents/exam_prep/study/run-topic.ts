import { getAgentOpenAI } from "@/lib/agents/clients";
import { AGENT_CHAT_MODEL } from "@/lib/agents/config";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import { retrieveStudyContext } from "@/lib/agents/exam_prep/study/retrieve-context";
import {
  STUDY_NOTE_AGENT_SYSTEM,
  STUDY_SUPERVISOR_REVIEW_SYSTEM,
  buildStudyNoteUserPrompt,
  buildStudyReviewUserPrompt,
} from "@/lib/agents/exam_prep/study/prompts";
import type {
  StudyTopicGenerateInput,
  StudyTopicGenerateResult,
} from "@/lib/agents/exam_prep/study/types";
import type { ProgressCallback } from "@/lib/exam-prep/progress";
import { emitStudyProgress } from "@/lib/exam-prep/progress";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const STEP_RETRIEVE = "study_retrieve";
const STEP_NOTE_DRAFT = "study_note_draft";
const STEP_SUPERVISOR_REVIEW = "study_supervisor_review";
const STEP_NOTE_REVISE = "study_note_revise";

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
    throw new Error("Supervisor inceleme yanıtı JSON değil.");
  }
}

async function generateStudyNote(
  input: StudyTopicGenerateInput,
  context: {
    materialContext: string;
    questionContext: string;
    questionImagesMarkdown: string;
  },
  revisionFeedback?: string,
): Promise<string> {
  const openai = getAgentOpenAI();

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      AGENT_CHAT_MODEL,
      [
        { role: "system", content: STUDY_NOTE_AGENT_SYSTEM },
        {
          role: "user",
          content: buildStudyNoteUserPrompt({
            briefing: input.topic.briefing,
            topicTitle: input.topic.title,
            unit: input.topic.unit,
            examGoal: input.examGoal,
            subject: input.subject,
            curriculum: input.curriculum,
            outcomesJson: JSON.stringify(
              input.topic.learningOutcomes,
              null,
              2,
            ),
            materialContext: context.materialContext,
            questionContext: context.questionContext,
            questionImagesMarkdown: context.questionImagesMarkdown,
            revisionFeedback,
          }),
        },
      ],
      { temperature: 0.35 },
    ),
  );

  const markdown = completion.choices[0]?.message?.content?.trim();
  if (!markdown) {
    throw new Error("Not ajanı boş yanıt döndü.");
  }

  return markdown;
}

async function reviewStudyNote(
  briefing: string,
  noteMarkdown: string,
): Promise<{ approved: boolean; revisionHints: string }> {
  const openai = getAgentOpenAI();

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      AGENT_CHAT_MODEL,
      [
        { role: "system", content: STUDY_SUPERVISOR_REVIEW_SYSTEM },
        {
          role: "user",
          content: buildStudyReviewUserPrompt({ briefing, noteMarkdown }),
        },
      ],
      { temperature: 0.15, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    return { approved: true, revisionHints: "" };
  }

  const parsed = extractJson(rawText) as Record<string, unknown>;
  return {
    approved: parsed.approved !== false,
    revisionHints: String(parsed.revision_hints ?? parsed.feedback ?? "").trim(),
  };
}

/** Tek konu/kazanım için not üretir → supervisor kontrol → gerekirse bir revizyon. */
export async function runStudyTopicGeneration(
  input: StudyTopicGenerateInput,
  onProgress?: ProgressCallback,
): Promise<StudyTopicGenerateResult> {
  const steps: string[] = [];
  const supabase = createSupabaseServerClient();
  const openai = getAgentOpenAI();

  let materialContext = "";
  let questionContext = "";
  let questionImagesMarkdown = "";

  if (supabase) {
    emitStudyProgress(onProgress, STEP_RETRIEVE);
    const retrieved = await retrieveStudyContext(supabase, openai, {
      title: input.topic.title,
      unit: input.topic.unit,
      learningOutcomes: input.topic.learningOutcomes,
      ownerUserId: input.ownerUserId,
      subject: input.subject,
      curriculum: input.curriculum,
    });
    materialContext = retrieved.materialText;
    questionContext = retrieved.questionText;
    questionImagesMarkdown = retrieved.questionImagesMarkdown;
    steps.push(STEP_RETRIEVE);
  }

  emitStudyProgress(onProgress, STEP_NOTE_DRAFT);
  let markdown = await generateStudyNote(input, {
    materialContext,
    questionContext,
    questionImagesMarkdown,
  });
  steps.push(STEP_NOTE_DRAFT);

  emitStudyProgress(onProgress, STEP_SUPERVISOR_REVIEW);
  const review = await reviewStudyNote(input.topic.briefing, markdown);
  steps.push(STEP_SUPERVISOR_REVIEW);

  let revised = false;
  if (!review.approved && review.revisionHints) {
    emitStudyProgress(onProgress, STEP_NOTE_REVISE);
    markdown = await generateStudyNote(
      input,
      {
        materialContext,
        questionContext,
        questionImagesMarkdown,
      },
      review.revisionHints,
    );
    revised = true;
    steps.push(STEP_NOTE_REVISE);
  }

  return {
    topicIndex: input.topicIndex,
    topicTitle: input.topic.title,
    markdown,
    revised,
    steps,
  };
}
