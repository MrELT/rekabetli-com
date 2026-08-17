import { createNotalOpenAI } from "@/lib/notal/openai-client";
import { extractOutputText } from "@/lib/notal/openai-helpers";

/** Topluluk özeti / SSS: GPT-5.6 Terra. */
export const COMMUNITY_NOTAL_MODEL = "gpt-5.6-terra";

const MAX_POSTS = 50;
const MAX_COMMENTS = 80;
const MAX_POST_CHARS = 700;
const MAX_COMMENT_CHARS = 400;
const MAX_CORPUS_CHARS = 18000;

export type CommunityNotalMode = "summary" | "faq";

export type CommunityNotalFaq = {
  question: string;
  answer: string;
};

export type CommunityNotalSummaryResult = {
  summary: string;
  highlights: string[];
};

export type CommunityNotalFaqResult = {
  faqs: CommunityNotalFaq[];
};

export type CommunityNotalCorpus = {
  name: string;
  purpose: string;
  posts: Array<{ title: string; content: string; comments: string[] }>;
};

function stripHtml(value: string): string {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function clip(value: string, max: number): string {
  const text = stripHtml(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function safeJsonParse(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenceMatch?.[1]) return null;
    try {
      return JSON.parse(fenceMatch[1]) as unknown;
    } catch {
      return null;
    }
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}

export function buildCommunityNotalCorpus(options: {
  name: string;
  purpose: string;
  posts: Array<{ id: string; title?: unknown; content?: unknown }>;
  commentsByPostId: Map<string, string[]>;
}): CommunityNotalCorpus {
  const posts: CommunityNotalCorpus["posts"] = [];
  let used = 0;

  for (const row of options.posts) {
    if (posts.length >= MAX_POSTS) break;
    const title = clip(asString(row?.title), 160);
    const content = clip(asString(row?.content), MAX_POST_CHARS);
    const comments = (options.commentsByPostId.get(row.id) || [])
      .slice(0, 8)
      .map((item) => clip(item, MAX_COMMENT_CHARS))
      .filter(Boolean);

    const blockLen = title.length + content.length + comments.join("").length;
    if (used + blockLen > MAX_CORPUS_CHARS) break;
    used += blockLen;
    posts.push({ title, content, comments });
  }

  return {
    name: clip(options.name, 120) || "Topluluk",
    purpose: clip(options.purpose, 800),
    posts,
  };
}

function formatCorpus(corpus: CommunityNotalCorpus): string {
  const lines = [
    `Topluluk adı: ${corpus.name}`,
    `Açıklama: ${corpus.purpose || "Açıklama yok."}`,
    `Paylaşım sayısı (özete alınan): ${corpus.posts.length}`,
    "",
  ];

  corpus.posts.forEach((post, index) => {
    lines.push(`--- Paylaşım ${index + 1} ---`);
    if (post.title) lines.push(`Başlık: ${post.title}`);
    if (post.content) lines.push(post.content);
    post.comments.forEach((comment, commentIndex) => {
      lines.push(`  Yanıt ${commentIndex + 1}: ${comment}`);
    });
    lines.push("");
  });

  return lines.join("\n").trim();
}

function normalizeSummary(raw: unknown, corpus: CommunityNotalCorpus): CommunityNotalSummaryResult {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const summary =
    asString(row.summary).slice(0, 1800) ||
    (corpus.purpose
      ? `${corpus.name} topluluğu: ${corpus.purpose}`
      : `${corpus.name} topluluğunda henüz özetlenecek yeterli paylaşım yok.`);
  return {
    summary,
    highlights: asStringList(row.highlights, 5).map((item) => item.slice(0, 220)),
  };
}

function normalizeFaqs(raw: unknown): CommunityNotalFaqResult {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(row.faqs) ? row.faqs : [];
  const faqs: CommunityNotalFaq[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const faq = item as Record<string, unknown>;
    const question = asString(faq.question ?? faq.q).slice(0, 220);
    const answer = asString(faq.answer ?? faq.a).slice(0, 800);
    if (!question || !answer) continue;
    faqs.push({ question, answer });
    if (faqs.length >= 8) break;
  }

  return { faqs };
}

async function runTerraJson(options: {
  instructions: string;
  input: string;
  maxOutputTokens: number;
}): Promise<unknown | null> {
  const openai = createNotalOpenAI();
  const response = await openai.responses.create({
    model: COMMUNITY_NOTAL_MODEL,
    instructions: options.instructions,
    input: [{ role: "user", content: options.input }],
    max_output_tokens: options.maxOutputTokens,
    reasoning: { effort: "low" },
  });
  return safeJsonParse(extractOutputText(response));
}

export async function generateCommunityNotalSummary(
  corpus: CommunityNotalCorpus,
): Promise<CommunityNotalSummaryResult> {
  const parsed = await runTerraJson({
    maxOutputTokens: 900,
    input: formatCorpus(corpus),
    instructions: `Sen NotAl topluluk özetleyicisisin (GPT-5.6 Terra).
Görevin: bir öğrenci topluluğunun açıklamasını ve paylaşımlarını inceleyip kısa bir özet yazmak.

Kurallar:
- Türkçe yaz.
- Sadece verilen açıklama ve paylaşımlara dayan; uydurma.
- Markdown (**kalın**, başlık) kullanma.
- 2-4 kısa paragraf özet ver.
- Topluluğun amacını, konuşulan konuları ve pratik havayı yansıt.
- Paylaşım yoksa açıklamadan özetle; yoksa bunu açıkça söyle.
- Sadece JSON döndür.

JSON şema:
{"summary":"...","highlights":["...","..."]}`,
  });
  return normalizeSummary(parsed, corpus);
}

export async function generateCommunityNotalFaqs(
  corpus: CommunityNotalCorpus,
): Promise<CommunityNotalFaqResult> {
  const parsed = await runTerraJson({
    maxOutputTokens: 1400,
    input: formatCorpus(corpus),
    instructions: `Sen NotAl topluluk SSS yazarısın (GPT-5.6 Terra).
Görevin: paylaşımlar, yanıtlar ve topluluk açıklamasından sıkça sorulan soruları ve cevaplarını çıkarmak.

Kurallar:
- Türkçe yaz.
- Sadece verilen içerikten soru-cevap üret; genel bilgi uydurma.
- Aynı konuyu tekrarlama.
- Cevaplar kısa, net ve topluluk bağlamına uygun olsun.
- Yeterli malzeme yoksa boş dizi döndür.
- 4-8 madde üretmeye çalış.
- Markdown kullanma.
- Sadece JSON döndür.

JSON şema:
{"faqs":[{"question":"...","answer":"..."}]}`,
  });
  return normalizeFaqs(parsed);
}

export const COMMUNITY_NOTAL_LIMITS = {
  MAX_POSTS,
  MAX_COMMENTS,
};
