import type { SupabaseClient } from "@supabase/supabase-js";

import type { KazanımAlignmentResult } from "@/lib/agents/exam_prep/alignment-types";
import type { StudyTopicItem } from "@/lib/agents/exam_prep/study/types";

export interface CreateStudySessionParams {
  ownerUserId: string;
  examGoal: string;
  curriculum: string | null;
  subject: string | null;
  queueSource: string;
  topics: StudyTopicItem[];
  alignmentSnapshot?: KazanımAlignmentResult | null;
}

export async function createStudySession(
  supabase: SupabaseClient,
  params: CreateStudySessionParams,
): Promise<string> {
  const { data, error } = await supabase
    .from("exam_prep_study_sessions")
    .insert({
      owner_user_id: params.ownerUserId,
      exam_goal: params.examGoal,
      curriculum: params.curriculum,
      subject: params.subject,
      queue_source: params.queueSource,
      topics: params.topics,
      alignment_snapshot: params.alignmentSnapshot ?? null,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw error ?? new Error("Çalışma oturumu oluşturulamadı.");
  }

  return String(data.id);
}

export async function getStudySession(
  supabase: SupabaseClient,
  sessionId: string,
  ownerUserId: string,
): Promise<{
  id: string;
  topics: StudyTopicItem[];
  queueSource: string;
} | null> {
  const { data, error } = await supabase
    .from("exam_prep_study_sessions")
    .select("id, topics, queue_source, owner_user_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !data || String(data.owner_user_id) !== ownerUserId) {
    return null;
  }

  return {
    id: String(data.id),
    topics: Array.isArray(data.topics) ? (data.topics as StudyTopicItem[]) : [],
    queueSource: String(data.queue_source ?? "material"),
  };
}

export async function getCachedStudyNote(
  supabase: SupabaseClient,
  sessionId: string,
  topicIndex: number,
): Promise<{
  markdown: string;
  revised: boolean;
  steps: string[];
} | null> {
  const { data, error } = await supabase
    .from("exam_prep_study_notes")
    .select("markdown, revised, steps")
    .eq("session_id", sessionId)
    .eq("topic_index", topicIndex)
    .maybeSingle();

  if (error || !data?.markdown) return null;

  return {
    markdown: String(data.markdown),
    revised: Boolean(data.revised),
    steps: Array.isArray(data.steps) ? (data.steps as string[]) : [],
  };
}

export async function saveStudyNote(
  supabase: SupabaseClient,
  params: {
    sessionId: string;
    topicIndex: number;
    topicTitle: string;
    markdown: string;
    revised: boolean;
    steps: string[];
  },
): Promise<void> {
  const { error } = await supabase.from("exam_prep_study_notes").upsert(
    {
      session_id: params.sessionId,
      topic_index: params.topicIndex,
      topic_title: params.topicTitle,
      markdown: params.markdown,
      revised: params.revised,
      steps: params.steps,
    },
    { onConflict: "session_id,topic_index" },
  );

  if (error) {
    throw error;
  }
}
