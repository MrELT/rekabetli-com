import OpenAI from "openai";

import { buildChatCompletionParams } from "@/lib/agents/llm";
import {
  YKS_FIGURE_DETECT_MODEL,
  YKS_FIGURE_MIN_BBOX_AREA,
} from "@/lib/yks-figures/constants";
import type {
  DetectedFigureRegion,
  DetectedQuestionRegion,
  NormalizedBbox,
  PageFigureDetection,
  YksFigureType,
} from "@/lib/yks-figures/types";
import { YKS_FIGURE_TYPES } from "@/lib/yks-figures/types";

const DETECT_SYSTEM_PROMPT = `Sen MEB/YKS ders kitabı sayfası analiz uzmanısın.
Sayfa görüntüsünde akademik figür, şema, grafik, tablo ve soru bloklarını tespit et.

Yanıt YALNIZCA JSON:
{
  "is_academic": true,
  "figures": [
    {
      "type": "diagram | graph | table | photo | other",
      "bbox": [xmin, ymin, xmax, ymax],
      "caption": "Figürün kısa açıklaması",
      "related_topics": ["konu1", "konu2"]
    }
  ],
  "questions": [
    {
      "bbox": [xmin, ymin, xmax, ymax],
      "text_preview": "Soru metninin kısa özeti"
    }
  ]
}

Kurallar:
- bbox: 0–1 arası normalize [xmin, ymin, xmax, ymax]
- Boş kenar boşlukları, sayfa numarası, logo, dekoratif çizgileri ATLA
- figures: şema, grafik, tablo, biyoloji çizimi vb.
- questions: numaralı soru blokları (varsa)
- Akademik içerik yoksa is_academic: false ve boş diziler`;

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
    throw new Error("Figür tespit yanıtı JSON değil.");
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

function normalizeFigureType(value: unknown): YksFigureType {
  const raw = String(value ?? "other").trim().toLowerCase();
  if (YKS_FIGURE_TYPES.includes(raw as YksFigureType)) {
    return raw as YksFigureType;
  }
  if (raw.includes("diagram") || raw.includes("şema")) return "diagram";
  if (raw.includes("graph") || raw.includes("grafik")) return "graph";
  if (raw.includes("table") || raw.includes("tablo")) return "table";
  if (raw.includes("question") || raw.includes("soru")) return "question";
  if (raw.includes("photo") || raw.includes("foto")) return "photo";
  return "other";
}

function parseDetection(raw: unknown): PageFigureDetection {
  if (!raw || typeof raw !== "object") {
    return { figures: [], questions: [], isAcademic: false };
  }

  const record = raw as Record<string, unknown>;
  const figures: DetectedFigureRegion[] = [];
  const questions: DetectedQuestionRegion[] = [];

  if (Array.isArray(record.figures)) {
    for (const item of record.figures) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const bbox = normalizeBbox(row.bbox ?? row.bounding_box);
      const caption = String(row.caption ?? row.description ?? "").trim();
      if (!bbox || !caption) continue;

      figures.push({
        figureType: normalizeFigureType(row.type ?? row.figure_type),
        bbox,
        caption,
        relatedTopics: Array.isArray(row.related_topics)
          ? row.related_topics.map((t) => String(t).trim()).filter(Boolean)
          : [],
      });
    }
  }

  if (Array.isArray(record.questions)) {
    for (const item of record.questions) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const bbox = normalizeBbox(row.bbox ?? row.bounding_box);
      const textPreview = String(
        row.text_preview ?? row.textPreview ?? row.text ?? "",
      ).trim();
      if (!bbox || !textPreview) continue;

      questions.push({ bbox, textPreview });
    }
  }

  const isAcademic =
    record.is_academic !== false &&
    (figures.length > 0 || questions.length > 0);

  return { figures, questions, isAcademic };
}

export async function detectFiguresOnPage(
  openai: OpenAI,
  pagePng: Buffer,
  options: { fileName: string; pageNumber: number; textHint?: string },
): Promise<PageFigureDetection> {
  const textSection = options.textHint?.trim()
    ? `\n\nSayfa metin katmanı ipucu:\n${options.textHint.slice(0, 4000)}`
    : "";

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      YKS_FIGURE_DETECT_MODEL,
      [
        { role: "system", content: DETECT_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Kaynak: ${options.fileName}, sayfa ${options.pageNumber}.${textSection}`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${pagePng.toString("base64")}`,
                detail: "low",
              },
            },
          ],
        },
      ],
      { temperature: 0.1, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Figür tespit boş yanıt döndü.");
  }

  return parseDetection(extractJson(rawText));
}
