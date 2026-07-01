import { NextRequest, NextResponse } from "next/server";

import { runStudyTopicGeneration } from "@/lib/agents/exam_prep/study/run-topic";
import type { StudyTopicGenerateInput, StudyTopicItem } from "@/lib/agents/exam_prep/study/types";
import type { ExamPrepCurriculum } from "@/lib/agents/exam_prep/types";
import { EXAM_PREP_CURRICULA } from "@/lib/agents/exam_prep/types";
import {
  createNdjsonStream,
  ndjsonStreamResponse,
} from "@/lib/exam-prep/ndjson-server";
import { emitStudyProgress } from "@/lib/exam-prep/progress";
import {
  getCachedStudyNote,
  getStudySession,
  saveStudyNote,
} from "@/lib/exam-prep/study-repository";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import { resolveAuthenticatedIdentity } from "@/lib/notal-request-identity";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseTopic(raw: unknown): StudyTopicItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const title = String(record.title ?? "").trim();
  if (!title) return null;

  return {
    index: Number(record.index ?? 0) || 0,
    title,
    unit: String(record.unit ?? "").trim() || title,
    briefing: String(record.briefing ?? title).trim(),
    learningOutcomes: Array.isArray(record.learningOutcomes)
      ? record.learningOutcomes
      : [],
    source: record.source === "curriculum" ? "curriculum" : "material",
  };
}

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY yapılandırması eksik." },
      { status: 500 },
    );
  }

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

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const sessionId =
    typeof record.sessionId === "string" && record.sessionId.trim()
      ? record.sessionId.trim()
      : null;
  const forceRegenerate = record.forceRegenerate === true;
  const useStream = record.stream === true;

  const topic = parseTopic(record.topic);
  if (!topic) {
    return NextResponse.json({ error: "Konu bilgisi eksik." }, { status: 400 });
  }

  const topicIndex = Number(record.topicIndex ?? topic.index) || 0;
  const totalTopics = Number(record.totalTopics ?? 1) || 1;
  const examGoal = String(record.examGoal ?? "YKS sınav hazırlığı").trim();
  const subject =
    typeof record.subject === "string" && record.subject.trim()
      ? record.subject.trim()
      : null;

  let curriculum: ExamPrepCurriculum | null = null;
  const rawCurriculum = String(record.curriculum ?? "").trim().toUpperCase();
  if (EXAM_PREP_CURRICULA.includes(rawCurriculum as ExamPrepCurriculum)) {
    curriculum = rawCurriculum as ExamPrepCurriculum;
  }

  const input: StudyTopicGenerateInput = {
    ownerUserId: identity.userId,
    sessionId,
    examGoal,
    curriculum,
    subject,
    topic,
    topicIndex,
    totalTopics,
  };

  const supabase = createSupabaseServerClient();

  if (supabase && sessionId && !forceRegenerate) {
    const session = await getStudySession(supabase, sessionId, identity.userId);
    if (!session) {
      return NextResponse.json(
        { error: "Çalışma oturumu bulunamadı." },
        { status: 404 },
      );
    }

    const cached = await getCachedStudyNote(supabase, sessionId, topicIndex);
    if (cached) {
      const cachedResult = {
        success: true,
        topicIndex,
        topicTitle: topic.title,
        markdown: cached.markdown,
        revised: cached.revised,
        steps: [...cached.steps, "study_cache_hit"],
        cached: true,
      };

      if (useStream) {
        const stream = createNdjsonStream(async (send) => {
          emitStudyProgress((update) => {
            send({ type: "progress", ...update });
          }, "study_cache_hit");
          send({ type: "complete", result: cachedResult });
        });
        return ndjsonStreamResponse(stream);
      }

      return NextResponse.json(cachedResult);
    }
  }

  if (useStream) {
    const stream = createNdjsonStream(async (send) => {
      const result = await runStudyTopicGeneration(input, (update) => {
        send({ type: "progress", ...update });
      });

      if (supabase && sessionId) {
        try {
          await saveStudyNote(supabase, {
            sessionId,
            topicIndex: result.topicIndex,
            topicTitle: result.topicTitle,
            markdown: result.markdown,
            revised: result.revised,
            steps: result.steps,
          });
        } catch (saveError) {
          console.warn("[study/generate] not cache kaydı atlandı:", saveError);
        }
      }

      send({
        type: "complete",
        result: { success: true, ...result, cached: false },
      });
    });

    return ndjsonStreamResponse(stream);
  }

  try {
    const result = await runStudyTopicGeneration(input);

    if (supabase && sessionId) {
      try {
        await saveStudyNote(supabase, {
          sessionId,
          topicIndex: result.topicIndex,
          topicTitle: result.topicTitle,
          markdown: result.markdown,
          revised: result.revised,
          steps: result.steps,
        });
      } catch (saveError) {
        console.warn("[study/generate] not cache kaydı atlandı:", saveError);
      }
    }

    return NextResponse.json({ success: true, ...result, cached: false });
  } catch (error) {
    console.error("[notal/exam-prep/study/generate] hata:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Konu notu üretilemedi.",
      },
      { status: 500 },
    );
  }
}
