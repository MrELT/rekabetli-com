import OpenAI from "openai";

import { getAgentOpenAI } from "@/lib/agents/clients";
import { AGENT_CHAT_MODEL } from "@/lib/agents/config";
import { buildChatCompletionParams } from "@/lib/agents/llm";
import type { StudentPdfPageImage } from "@/lib/agents/exam_prep/types";
import { EXAM_PREP_VISION_BATCH_SIZE } from "@/lib/exam-prep/constants";

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
    throw new Error("Vision analiz yanıtı JSON değil.");
  }
}

function chunkPages<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildImageParts(
  pages: StudentPdfPageImage[],
): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  return pages.map((page) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/png;base64,${page.pngBase64}`,
      detail: "low" as const,
    },
  }));
}

async function analyzeVisionBatch(
  openai: OpenAI,
  options: {
    systemPrompt: string;
    userText: string;
    pages: StudentPdfPageImage[];
    batchIndex: number;
    batchCount: number;
  },
): Promise<unknown> {
  const batchNote =
    options.batchCount > 1
      ? `\n\nBu istek ${options.batchIndex + 1}/${options.batchCount} görsel grubudur; tüm grupları birlikte düşün.`
      : "";

  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `${options.userText}${batchNote}\n\nSayfa görselleri: ${options.pages.map((p) => p.pageNumber).join(", ")}`,
    },
    ...buildImageParts(options.pages),
  ];

  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      AGENT_CHAT_MODEL,
      [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: userContent },
      ],
      { temperature: 0.15, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Vision analiz boş yanıt döndü.");
  }

  return extractJson(rawText);
}

async function mergeVisionPartials(
  openai: OpenAI,
  systemPrompt: string,
  partials: unknown[],
): Promise<unknown> {
  const completion = await openai.chat.completions.create(
    buildChatCompletionParams(
      AGENT_CHAT_MODEL,
      [
        {
          role: "system",
          content: `${systemPrompt}\n\nBirden fazla sayfa grubu analizi birleştirilecek. Tek bir tutarlı JSON üret.`,
        },
        {
          role: "user",
          content: `Kısmi JSON analizleri:\n${JSON.stringify(partials, null, 2)}\n\nGörev: Bunları tek JSON'da birleştir. Sayıları topla, konu listelerini birleştir (tekrarları çıkar).`,
        },
      ],
      { temperature: 0.1, responseFormat: { type: "json_object" } },
    ),
  );

  const rawText = completion.choices[0]?.message?.content?.trim();
  if (!rawText) {
    throw new Error("Vision birleştirme boş yanıt döndü.");
  }

  return extractJson(rawText);
}

/** Taranmış PDF sayfa görselleri üzerinden JSON analiz. */
export async function runVisionJsonAnalysis(options: {
  systemPrompt: string;
  userText: string;
  pageImages: StudentPdfPageImage[];
}): Promise<unknown> {
  const openai = getAgentOpenAI();
  const batches = chunkPages(options.pageImages, EXAM_PREP_VISION_BATCH_SIZE);

  if (batches.length === 1) {
    return analyzeVisionBatch(openai, {
      systemPrompt: options.systemPrompt,
      userText: options.userText,
      pages: batches[0],
      batchIndex: 0,
      batchCount: 1,
    });
  }

  const partials: unknown[] = [];
  for (let index = 0; index < batches.length; index++) {
    partials.push(
      await analyzeVisionBatch(openai, {
        systemPrompt: options.systemPrompt,
        userText: options.userText,
        pages: batches[index],
        batchIndex: index,
        batchCount: batches.length,
      }),
    );
  }

  return mergeVisionPartials(openai, options.systemPrompt, partials);
}
