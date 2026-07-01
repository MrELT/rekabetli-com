import OpenAI from "openai";

import { buildChatCompletionParams } from "@/lib/agents/llm";
import { YKS_FIGURE_DETECT_MODEL } from "@/lib/yks-figures/constants";
import { extractJson, normalizeBbox } from "@/lib/yks-figures/bbox-utils";
import type { DetectedQuestionRegion } from "@/lib/yks-figures/types";

const QUESTION_DETECT_PROMPT = `Sen taranmış YKS/ÖSYM çoktan seçmeli SORU KİTABI sayfa analiz uzmanısın.
Sayfadaki her numaralı soru bloğunu ayrı ayrı kutula.

Yanıt YALNIZCA JSON:
{
  "questions": [
    {
      "index": 0,
      "bbox": [xmin, ymin, xmax, ymax],
      "text_preview": "Soru kökünün kısa özeti",
      "options_visible": ["A", "B", "C", "D"],
      "complete": true
    }
  ]
}

Kurallar:
- bbox: 0–1 normalize [xmin, ymin, xmax, ymax]
- Her bbox: soru numarası/kökü + TÜM şıklar (A,B,C,D ve varsa E) TAMAMEN içinde olmalı
- Şıkların altı veya üstü kesiliyorsa complete: false ve bbox'ı genişlet
- Komşu soru, başlık, sayfa numarası, logo bbox DIŞINDA kalmalı
- options_visible: kutu içinde net görünen şık harfleri
- complete: true yalnızca tüm şıklar kesilmeden görünüyorsa
- Soru yoksa questions: []`;

function parseQuestions(raw: unknown): DetectedQuestionRegion[] {
  if (!raw || typeof raw !== "object") return [];

  const record = raw as Record<string, unknown>;
  const rows = Array.isArray(record.questions) ? record.questions : [];
  const questions: DetectedQuestionRegion[] = [];

  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const bbox = normalizeBbox(row.bbox ?? row.bounding_box);
    const textPreview = String(
      row.text_preview ?? row.textPreview ?? row.text ?? "",
    ).trim();
    if (!bbox || !textPreview) continue;

    const optionsVisible = Array.isArray(row.options_visible)
      ? row.options_visible.map((o) => String(o).trim().toUpperCase()).filter(Boolean)
      : [];

    questions.push({
      bbox,
      textPreview,
      complete: row.complete === true,
      optionsVisible,
      index: Number(row.index ?? questions.length) || questions.length,
    });
  }

  return questions.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/** Taranmış soru sayfasında tüm soru bloklarını tek geçişte tespit eder. */
export async function detectQuestionsOnPage(
  openai: OpenAI,
  pagePng: Buffer,
  options: { fileName: string; pageNumber: number },
): Promise<DetectedQuestionRegion[]> {
  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      YKS_FIGURE_DETECT_MODEL,
      [
        { role: "system", content: QUESTION_DETECT_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Kaynak: ${options.fileName}, sayfa ${options.pageNumber}. Üstten alta tüm soruları bul.`,
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
      { temperature: 0.08, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Soru tespiti boş yanıt döndü.");
  }

  return parseQuestions(extractJson(rawText));
}
