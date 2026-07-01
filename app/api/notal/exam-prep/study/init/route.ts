import { NextRequest, NextResponse } from "next/server";

import { buildStudyTopicQueue } from "@/lib/agents/exam_prep/study/build-topic-queue";
import type { KazanımAlignmentResult } from "@/lib/agents/exam_prep/alignment-types";
import type { StudyInitInput } from "@/lib/agents/exam_prep/study/types";
import type {
  CurriculumPdfReport,
  ExamPrepCurriculum,
  MaterialPdfReport,
  QuestionPdfReport,
} from "@/lib/agents/exam_prep/types";
import { EXAM_PREP_CURRICULA } from "@/lib/agents/exam_prep/types";
import { createStudySession } from "@/lib/exam-prep/study-repository";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import { resolveAuthenticatedIdentity } from "@/lib/notal-request-identity";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseInitBody(
  body: unknown,
  ownerUserId: string,
): StudyInitInput | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  const examGoal = String(record.examGoal ?? "").trim();
  const subject =
    typeof record.subject === "string" && record.subject.trim()
      ? record.subject.trim()
      : null;

  let curriculum: ExamPrepCurriculum | null = null;
  const rawCurriculum = String(record.curriculum ?? "").trim().toUpperCase();
  if (EXAM_PREP_CURRICULA.includes(rawCurriculum as ExamPrepCurriculum)) {
    curriculum = rawCurriculum as ExamPrepCurriculum;
  }

  const kazanımAlignment =
    record.kazanımAlignment && typeof record.kazanımAlignment === "object"
      ? (record.kazanımAlignment as KazanımAlignmentResult)
      : null;

  return {
    examGoal: examGoal || "YKS sınav hazırlığı",
    curriculum,
    subject,
    materialReports: Array.isArray(record.materialReports)
      ? (record.materialReports as MaterialPdfReport[])
      : [],
    questionReports: Array.isArray(record.questionReports)
      ? (record.questionReports as QuestionPdfReport[])
      : [],
    curriculumReports: Array.isArray(record.curriculumReports)
      ? (record.curriculumReports as CurriculumPdfReport[])
      : [],
    kazanımAlignment,
    ownerUserId,
  };
}

export async function POST(request: NextRequest) {
  const identity = await resolveAuthenticatedIdentity(request);
  if (!identity?.userId) {
    return notalAuthRequiredResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON." }, { status: 400 });
  }

  const input = parseInitBody(body, identity.userId);
  if (!input) {
    return NextResponse.json({ error: "Geçersiz istek gövdesi." }, { status: 400 });
  }

  const result = buildStudyTopicQueue(input);
  const supabase = createSupabaseServerClient();

  if (supabase) {
    try {
      const sessionId = await createStudySession(supabase, {
        ownerUserId: identity.userId,
        examGoal: input.examGoal,
        curriculum: input.curriculum,
        subject: input.subject,
        queueSource: result.queueSource,
        topics: result.topics,
        alignmentSnapshot: input.kazanımAlignment,
      });
      result.sessionId = sessionId;
    } catch (error) {
      console.warn("[study/init] oturum kaydı atlandı:", error);
    }
  }

  return NextResponse.json({ success: true, ...result });
}
