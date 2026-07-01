import OpenAI from "openai";

import { buildChatCompletionParams } from "@/lib/agents/llm";
import {
  YKS_FIGURE_DETECT_MODEL,
  YKS_FIGURE_MIN_BBOX_AREA,
} from "@/lib/yks-figures/constants";
import type { NormalizedBbox } from "@/lib/yks-figures/types";

const REVISE_SYSTEM_PROMPT = `Sen taranmış YKS/ÖSYM çoktan seçmeli soru kırpma kalite kontrol uzmanısın.
Öğrencinin çalışacağı soru görseli: soru kökü + TÜM şıklar (A, B, C, D ve varsa E) eksiksiz görünmeli.

Sana verilenler:
1) Tam sayfa görüntüsü
2) İlk otomatik kırpım (muhtemelen hatalı olabilir)
3) İlk bbox koordinatları (0–1 normalize)

Görevin: kırpımı incele; eksik veya fazla alan varsa tam sayfa üzerinde düzeltilmiş bbox öner.

Yanıt YALNIZCA JSON:
{
  "needs_revision": true,
  "complete": false,
  "issues": ["C ve D şıkları kesilmiş", "altında komşu soru var"],
  "bbox": [xmin, ymin, xmax, ymax]
}

Kurallar:
- bbox: 0–1 normalize [xmin, ymin, xmax, ymax], TAM SAYFA koordinatında
- complete: true yalnızca soru kökü + tüm şıklar net ve kesilmeden görünüyorsa
- needs_revision: false yalnızca mevcut kırpım zaten complete ise
- Şıkların herhangi biri kesilmişse needs_revision: true ve bbox'ı genişlet
- Komşu soru, üst/alt başlık, sayfa numarası, logo, geniş boş kenar varsa bbox'ı daralt
- Birden fazla soru bir arada kesilmişse yalnızca hedef soruyu kapsayacak şekilde daralt
- bbox her zaman geçerli dikdörtgen; xmin<xmax, ymin<ymax`;

export interface QuestionCropRevisionResult {
  bbox: NormalizedBbox;
  wasRevised: boolean;
  needsRevision: boolean;
  complete: boolean;
  issues: string[];
}

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
    throw new Error("Soru kırpım revizyon yanıtı JSON değil.");
  }
}

function normalizeBbox(raw: unknown): NormalizedBbox | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const nums = raw.slice(0, 4).map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return null;

  let [xmin, ymin, xmax, ymax] = nums.map((n) => Math.min(1, Math.max(0, n)));
  if (xmax < xmin) [xmin, xmax] = [xmax, xmin];
  if (ymax < ymin) [ymin, ymax] = [ymax, ymin];

  const area = (xmax - xmin) * (ymax - ymin);
  if (area < YKS_FIGURE_MIN_BBOX_AREA) return null;

  return [xmin, ymin, xmax, ymax];
}

function bboxChanged(a: NormalizedBbox, b: NormalizedBbox): boolean {
  const threshold = 0.008;
  return (
    Math.abs(a[0] - b[0]) > threshold ||
    Math.abs(a[1] - b[1]) > threshold ||
    Math.abs(a[2] - b[2]) > threshold ||
    Math.abs(a[3] - b[3]) > threshold
  );
}

function parseRevision(
  raw: unknown,
  initialBbox: NormalizedBbox,
): QuestionCropRevisionResult {
  if (!raw || typeof raw !== "object") {
    return {
      bbox: initialBbox,
      wasRevised: false,
      needsRevision: false,
      complete: false,
      issues: ["revizyon yanıtı geçersiz"],
    };
  }

  const record = raw as Record<string, unknown>;
  const issues = Array.isArray(record.issues)
    ? record.issues.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const complete = record.complete === true;
  const needsRevision = record.needs_revision === true;
  const revisedBbox = normalizeBbox(record.bbox);

  if (!needsRevision || !revisedBbox) {
    return {
      bbox: initialBbox,
      wasRevised: false,
      needsRevision: false,
      complete,
      issues,
    };
  }

  return {
    bbox: revisedBbox,
    wasRevised: bboxChanged(initialBbox, revisedBbox),
    needsRevision: true,
    complete,
    issues,
  };
}

/** İlk kırpımdan sonra soru görselinin tam ve gereksiz alansız olduğunu doğrular; gerekirse bbox düzeltir. */
export async function reviseQuestionCrop(
  openai: OpenAI,
  options: {
    pagePng: Buffer;
    croppedPng: Buffer;
    initialBbox: NormalizedBbox;
    textPreview: string;
    fileName: string;
    pageNumber: number;
  },
): Promise<QuestionCropRevisionResult> {
  const [xmin, ymin, xmax, ymax] = options.initialBbox;
  const preview = options.textPreview.trim() || "Soru";

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      YKS_FIGURE_DETECT_MODEL,
      [
        { role: "system", content: REVISE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Kaynak: ${options.fileName}, sayfa ${options.pageNumber}`,
                `Soru özeti: ${preview}`,
                `İlk bbox (normalize): [${xmin.toFixed(3)}, ${ymin.toFixed(3)}, ${xmax.toFixed(3)}, ${ymax.toFixed(3)}]`,
                "",
                "1. görsel: tam sayfa",
                "2. görsel: mevcut kırpım — eksik şık veya fazla alan var mı kontrol et",
              ].join("\n"),
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${options.pagePng.toString("base64")}`,
                detail: "low",
              },
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${options.croppedPng.toString("base64")}`,
                detail: "high",
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
    return {
      bbox: options.initialBbox,
      wasRevised: false,
      needsRevision: false,
      complete: false,
      issues: ["revizyon boş yanıt"],
    };
  }

  return parseRevision(extractJson(rawText), options.initialBbox);
}
