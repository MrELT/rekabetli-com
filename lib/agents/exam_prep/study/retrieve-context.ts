import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import type { LearningOutcome } from "@/lib/agents/exam_prep/alignment-types";
import type { StudyRetrievedContext } from "@/lib/agents/exam_prep/study/types";
import type { ExamPrepCurriculum } from "@/lib/agents/exam_prep/types";
import { formatYksChunksForContext, matchYksChunks } from "@/lib/yks-chunks/rag";
import {
  buildMarkdownFromYksFigure,
  matchYksFiguresMany,
} from "@/lib/yks-figures/rag";

interface ChunkMetadata {
  ownerUserId?: string;
  contentRole?: string;
  pipeline?: string;
}

function parseMetadata(raw: unknown): ChunkMetadata {
  if (!raw || typeof raw !== "object") return {};
  return raw as ChunkMetadata;
}

function buildStudyQuery(
  title: string,
  outcomes: LearningOutcome[],
  subject?: string | null,
): string {
  return [
    title,
    subject ? `Ders: ${subject}` : "",
    ...outcomes.map((o) => `${o.code} ${o.title} ${o.unit}`),
    "YKS konu anlatımı soru çözümü",
  ]
    .filter(Boolean)
    .join(". ");
}

export async function retrieveStudyContext(
  supabase: SupabaseClient,
  openai: OpenAI,
  options: {
    title: string;
    unit: string;
    learningOutcomes: LearningOutcome[];
    ownerUserId: string;
    subject?: string | null;
    curriculum?: ExamPrepCurriculum | null;
  },
): Promise<StudyRetrievedContext> {
  const query = buildStudyQuery(
    options.title,
    options.learningOutcomes,
    options.subject,
  );

  const filterCurriculum =
    options.curriculum === "TYT" || options.curriculum === "AYT"
      ? options.curriculum
      : null;

  const rawMatches = await matchYksChunks(supabase, openai, query, {
    filterSubject: options.subject,
    filterCurriculum,
    threshold: 0.62,
    count: 20,
  });

  const { data: metaRows } = await supabase
    .from("yks_chunks")
    .select("id, metadata, chunk_type")
    .in(
      "id",
      rawMatches.map((m) => m.id),
    );

  const metaById = new Map(
    (metaRows ?? []).map((row) => [String(row.id), row]),
  );

  const enriched = rawMatches.map((match) => ({
    ...match,
    metadata: metaById.get(match.id)?.metadata,
    chunk_type: metaById.get(match.id)?.chunk_type ?? match.chunkType,
  }));

  const ownerRows = enriched.filter((row) => {
    const meta = parseMetadata(row.metadata);
    if (meta.pipeline === "exam_prep" && meta.ownerUserId) {
      return meta.ownerUserId === options.ownerUserId;
    }
    return true;
  });

  const materialMatches = ownerRows.filter((row) => {
    const meta = parseMetadata(row.metadata);
    const chunkType = String(row.chunk_type ?? row.chunkType);
    if (meta.contentRole === "question") return false;
    if (chunkType === "question") return false;
    return (
      meta.contentRole === "material" ||
      meta.contentRole === "curriculum" ||
      ["explanation", "definition", "theorem", "example", "curriculum"].includes(
        chunkType,
      )
    );
  });

  const questionMatches = ownerRows.filter((row) => {
    const meta = parseMetadata(row.metadata);
    const chunkType = String(row.chunk_type ?? row.chunkType);
    return meta.contentRole === "question" || chunkType === "question";
  });

  const figures = await matchYksFiguresMany(supabase, openai, query, {
    filterSubject: options.subject,
    filterCurriculum,
    threshold: 0.6,
    count: 8,
  });

  const { data: figureMetaRows } = await supabase
    .from("yks_figures")
    .select("id, metadata")
    .in(
      "id",
      figures.map((f) => f.id),
    );

  const figureMetaById = new Map(
    (figureMetaRows ?? []).map((row) => [String(row.id), row.metadata]),
  );

  const ownerFigures = figures.filter((figure) => {
    const meta = parseMetadata(figureMetaById.get(figure.id));
    if (meta.pipeline === "exam_prep" && meta.ownerUserId) {
      return meta.ownerUserId === options.ownerUserId;
    }
    return true;
  });

  const questionFigures = ownerFigures.filter((f) => f.figureType === "question");
  const questionImagesMarkdown = questionFigures
    .map((f) => buildMarkdownFromYksFigure(f))
    .join("\n\n");

  return {
    materialText: materialMatches.length
      ? formatYksChunksForContext(materialMatches)
      : "Kaynak chunk bulunamadı — genel bilgiyle destekle.",
    questionText: questionMatches.length
      ? formatYksChunksForContext(questionMatches)
      : "",
    questionImagesMarkdown,
    materialChunkCount: materialMatches.length,
    questionChunkCount: questionMatches.length,
    figureCount: questionFigures.length,
  };
}
