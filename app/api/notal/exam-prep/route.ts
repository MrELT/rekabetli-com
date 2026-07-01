import { NextRequest, NextResponse } from "next/server";

import type { ExamPrepCurriculum } from "@/lib/agents/exam_prep/types";
import { EXAM_PREP_CURRICULA } from "@/lib/agents/exam_prep/types";
import { executeExamPrepAnalysis } from "@/lib/exam-prep/execute-exam-prep";
import {
  createNdjsonStream,
  ndjsonStreamResponse,
} from "@/lib/exam-prep/ndjson-server";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import { resolveAuthenticatedIdentity } from "@/lib/notal-request-identity";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseCurriculum(value: FormDataEntryValue | null): ExamPrepCurriculum | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "TYT" || normalized === "AYT") return normalized;
  if (normalized === "GENEL") return "genel";
  return EXAM_PREP_CURRICULA.includes(normalized as ExamPrepCurriculum)
    ? (normalized as ExamPrepCurriculum)
    : null;
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

  const ownerUserId = identity.userId;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Geçersiz form verisi." }, { status: 400 });
  }

  const curriculum = parseCurriculum(formData.get("curriculum"));
  const useStream = formData.get("stream") === "1";

  if (useStream) {
    const stream = createNdjsonStream(async (send) => {
      const { result, ingestErrors, visionPdfCount } =
        await executeExamPrepAnalysis({
          formData,
          ownerUserId: ownerUserId,
          curriculum,
          onProgress: (update) => {
            send({ type: "progress", ...update });
          },
        });

      send({
        type: "complete",
        result: {
          success: true,
          ...result,
          ingestErrors,
          visionPdfCount,
        },
      });
    });

    return ndjsonStreamResponse(stream);
  }

  try {
    const { result, ingestErrors, visionPdfCount } =
      await executeExamPrepAnalysis({
        formData,
        ownerUserId,
        curriculum,
      });

    return NextResponse.json({
      success: true,
      ...result,
      ingestErrors,
      visionPdfCount,
    });
  } catch (error) {
    console.error("[notal/exam-prep] analiz hatası:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Materyal analizi başarısız.",
      },
      { status: 500 },
    );
  }
}
