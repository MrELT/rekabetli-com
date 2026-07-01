import OpenAI from "openai";

import { buildChatCompletionParams } from "@/lib/agents/llm";
import { YKS_FIGURE_DETECT_MODEL } from "@/lib/yks-figures/constants";
import {
  bboxChanged,
  extractJson,
  normalizeBbox,
} from "@/lib/yks-figures/bbox-utils";
import type { DetectedQuestionRegion, NormalizedBbox } from "@/lib/yks-figures/types";

const PAGE_REVISE_PROMPT = `Sen taranmış YKS soru sayfası kırpım kalite kontrol uzmanısın.
Sayfadaki her soru kutusu: soru kökü + TÜM şıklar (A–E) eksiksiz olmalı; komşu soru veya gereksiz boşluk olmamalı.

Sana tam sayfa görüntüsü ve mevcut bbox listesi verilir. Her soru için bbox'ı gözden geçir.

Yanıt YALNIZCA JSON:
{
  "questions": [
    {
      "index": 0,
      "needs_revision": true,
      "complete": false,
      "bbox": [xmin, ymin, xmax, ymax],
      "issues": ["C ve D şıkları kesilmiş"]
    }
  ]
}

Kurallar:
- bbox tam sayfa koordinatında 0–1 normalize
- needs_revision: false yalnızca bbox zaten mükemmel ise
- Şık kesilmişse genişlet; fazla alan varsa daralt
- index alanı girdi ile eşleşmeli`;

export interface PageQuestionRevision {
  index: number;
  bbox: NormalizedBbox;
  needsRevision: boolean;
  complete: boolean;
  issues: string[];
  wasRevised: boolean;
}

function parsePageRevisions(
  raw: unknown,
  initial: DetectedQuestionRegion[],
): PageQuestionRevision[] {
  if (!raw || typeof raw !== "object") {
    return initial.map((question, index) => ({
      index,
      bbox: question.bbox,
      needsRevision: false,
      complete: question.complete ?? false,
      issues: [],
      wasRevised: false,
    }));
  }

  const record = raw as Record<string, unknown>;
  const rows = Array.isArray(record.questions) ? record.questions : [];
  const byIndex = new Map<number, PageQuestionRevision>();

  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const index = Number(row.index ?? -1);
    if (index < 0) continue;

    const initialQuestion = initial[index];
    const initialBbox = initialQuestion?.bbox;
    if (!initialBbox) continue;

    const issues = Array.isArray(row.issues)
      ? row.issues.map((entry) => String(entry).trim()).filter(Boolean)
      : [];
    const complete = row.complete === true;
    const needsRevision = row.needs_revision === true;
    const revisedBbox = normalizeBbox(row.bbox);

    if (needsRevision && revisedBbox) {
      byIndex.set(index, {
        index,
        bbox: revisedBbox,
        needsRevision: true,
        complete,
        issues,
        wasRevised: bboxChanged(initialBbox, revisedBbox),
      });
      continue;
    }

    byIndex.set(index, {
      index,
      bbox: initialBbox,
      needsRevision: false,
      complete: complete || (initialQuestion.complete ?? false),
      issues,
      wasRevised: false,
    });
  }

  return initial.map((question, index) => {
    const revised = byIndex.get(index);
    if (revised) return revised;

    return {
      index,
      bbox: question.bbox,
      needsRevision: false,
      complete: question.complete ?? false,
      issues: [],
      wasRevised: false,
    };
  });
}

function buildQuestionSummary(questions: DetectedQuestionRegion[]): string {
  return questions
    .map((question, index) => {
      const [xmin, ymin, xmax, ymax] = question.bbox;
      const options = question.optionsVisible?.length
        ? question.optionsVisible.join(", ")
        : "?";
      return [
        `#${index}: bbox=[${xmin.toFixed(3)},${ymin.toFixed(3)},${xmax.toFixed(3)},${ymax.toFixed(3)}]`,
        `complete=${question.complete ? "true" : "false"}`,
        `options=${options}`,
        `preview=${question.textPreview.slice(0, 80)}`,
      ].join(" | ");
    })
    .join("\n");
}

/** Sayfadaki tüm soru kırpımlarını tek vision çağrısında revize eder. */
export async function reviseQuestionCropsOnPage(
  openai: OpenAI,
  options: {
    pagePng: Buffer;
    questions: DetectedQuestionRegion[];
    fileName: string;
    pageNumber: number;
  },
): Promise<PageQuestionRevision[]> {
  if (!options.questions.length) return [];

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      YKS_FIGURE_DETECT_MODEL,
      [
        { role: "system", content: PAGE_REVISE_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Kaynak: ${options.fileName}, sayfa ${options.pageNumber}`,
                `Soru sayısı: ${options.questions.length}`,
                "",
                "Mevcut bbox listesi:",
                buildQuestionSummary(options.questions),
              ].join("\n"),
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${options.pagePng.toString("base64")}`,
                detail: "low",
              },
            },
          ],
        },
      ],
      { temperature: 0.05, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    return options.questions.map((question, index) => ({
      index,
      bbox: question.bbox,
      needsRevision: false,
      complete: question.complete ?? false,
      issues: ["sayfa revizyonu boş yanıt"],
      wasRevised: false,
    }));
  }

  return parsePageRevisions(extractJson(rawText), options.questions);
}

export function shouldReviseQuestionPage(
  questions: DetectedQuestionRegion[],
): boolean {
  if (!questions.length) return false;
  return questions.some((question) => question.complete !== true);
}
