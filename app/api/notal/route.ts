import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildNotalSystemPrompt,
  buildNotalUserPrompt,
  isValidNotalDifficulty,
  type NotalDifficulty,
} from "@/lib/notal-difficulty";
import { consumeNotalCredit, refundNotalCredit } from "@/lib/notal-credits-server";
import { classifyNotalSubject } from "@/lib/notal-subject-classifier";
import { saveNotalNote } from "@/lib/notal-notes-server";
import { enforceRateLimit } from "@/lib/notal-rate-limit";
import { notalAuthRequiredResponse } from "@/lib/notal-auth-response";
import {
  identityRateLimitKey,
  resolveAuthenticatedIdentity,
} from "@/lib/notal-request-identity";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_TOPIC_LENGTH = 200;
const CHAT_MODEL = "gpt-5.4-mini";
const CHAT_TEMPERATURE = 0.4;
const CHAT_MAX_OUTPUT = 8192;

/** gpt-5 / o-serisi modeller max_tokens yerine max_completion_tokens kullanır */
function usesMaxCompletionTokens(model: string): boolean {
  return /^gpt-5|^o\d/i.test(model);
}

function buildChatOptions(model: string) {
  const base = {
    model,
    temperature: CHAT_TEMPERATURE,
    messages: [] as { role: "system" | "user"; content: string }[],
  };

  if (usesMaxCompletionTokens(model)) {
    return { ...base, max_completion_tokens: CHAT_MAX_OUTPUT };
  }
  return { ...base, max_tokens: CHAT_MAX_OUTPUT };
}

const EMBEDDING_MODEL = "text-embedding-3-small";
const RAG_MATCH_COUNT = 8;
const RAG_MATCH_THRESHOLD = 0.7;

type AcademicSourceType =
  | "book"
  | "presentation"
  | "exam_question"
  | "article"
  | string;

interface AcademicLibraryMatch {
  id?: string;
  content: string;
  source_type: AcademicSourceType;
  title?: string | null;
  source_name?: string | null;
  similarity?: number | null;
}

async function createTopicEmbedding(
  openai: OpenAI,
  topic: string,
): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: topic,
  });

  const embedding = response.data[0]?.embedding;

  if (!embedding?.length) {
    throw new Error("Embedding oluşturulamadı.");
  }

  return embedding;
}

async function retrieveAcademicLibrary(
  supabase: SupabaseClient,
  queryEmbedding: number[],
): Promise<AcademicLibraryMatch[]> {
  const { data, error } = await supabase.rpc("match_academic_library", {
    query_embedding: queryEmbedding,
    match_threshold: RAG_MATCH_THRESHOLD,
    match_count: RAG_MATCH_COUNT,
  });

  if (error) {
    throw error;
  }

  if (!Array.isArray(data)) return [];

  return data.filter(
    (row): row is AcademicLibraryMatch =>
      typeof row === "object" &&
      row !== null &&
      "content" in row &&
      typeof (row as AcademicLibraryMatch).content === "string",
  );
}

function formatMatchBlock(match: AcademicLibraryMatch, index: number): string {
  const label =
    match.source_name?.trim() ||
    match.title?.trim() ||
    `Kaynak ${index + 1}`;
  const similarity =
    typeof match.similarity === "number"
      ? ` | benzerlik: ${(match.similarity * 100).toFixed(1)}%`
      : "";

  return `[${label}${similarity}]\n${match.content.trim()}`;
}

function buildAcademicContext(matches: AcademicLibraryMatch[]): string {
  if (!matches.length) {
    return "Bu konu için arşivden eşleşen kaynak bulunamadı.";
  }

  const books: string[] = [];
  const presentations: string[] = [];
  const examQuestions: string[] = [];
  const articles: string[] = [];
  const other: string[] = [];

  matches.forEach((match, index) => {
    const block = formatMatchBlock(match, index);
    const type = match.source_type?.toLowerCase() ?? "";

    if (type === "book" || type.includes("kitap")) {
      books.push(block);
    } else if (
      type === "presentation" ||
      type.includes("sunum") ||
      type.includes("slide")
    ) {
      presentations.push(block);
    } else if (
      type === "exam_question" ||
      type.includes("soru") ||
      type.includes("exam")
    ) {
      examQuestions.push(block);
    } else if (type === "article" || type.includes("makale")) {
      articles.push(block);
    } else {
      other.push(block);
    }
  });

  const sections: string[] = [];

  if (books.length) {
    sections.push(
      `#### Kitap Kesitleri\n${books.join("\n\n---\n\n")}`,
    );
  }
  if (presentations.length) {
    sections.push(
      `#### Sunum / Slayt Notları\n${presentations.join("\n\n---\n\n")}`,
    );
  }
  if (examQuestions.length) {
    sections.push(
      `#### Çıkmış Sorular\n${examQuestions.join("\n\n---\n\n")}`,
    );
  }
  if (articles.length) {
    sections.push(`#### Makale Alıntıları\n${articles.join("\n\n---\n\n")}`);
  }
  if (other.length) {
    sections.push(`#### Diğer Kaynaklar\n${other.join("\n\n---\n\n")}`);
  }

  return sections.join("\n\n");
}

async function fetchAcademicContextForTopic(
  openai: OpenAI,
  topic: string,
): Promise<string> {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    console.warn(
      "NotAl RAG: SUPABASE_URL veya anahtar eksik; kaynak araması atlandı.",
    );
    return "Akademik arşiv yapılandırması eksik; kaynak araması yapılamadı.";
  }

  try {
    const queryEmbedding = await createTopicEmbedding(openai, topic);
    const matches = await retrieveAcademicLibrary(supabase, queryEmbedding);
    return buildAcademicContext(matches);
  } catch (error) {
    console.error("NotAl RAG hatası:", error);
    return "Kaynak arşivi geçici olarak ulaşılamıyor; genel bilgiyle yanıtlanacak.";
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Sunucu yapılandırması eksik." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  const topic =
    typeof body === "object" &&
    body !== null &&
    "topic" in body &&
    typeof (body as { topic: unknown }).topic === "string"
      ? (body as { topic: string }).topic.trim()
      : "";

  if (!topic) {
    return NextResponse.json({ error: "Konu gerekli." }, { status: 400 });
  }

  if (topic.length > MAX_TOPIC_LENGTH) {
    return NextResponse.json(
      { error: `Konu en fazla ${MAX_TOPIC_LENGTH} karakter olabilir.` },
      { status: 400 },
    );
  }

  const rawDifficulty =
    typeof body === "object" &&
    body !== null &&
    "difficulty" in body &&
    typeof (body as { difficulty: unknown }).difficulty === "string"
      ? (body as { difficulty: string }).difficulty.trim().toLowerCase()
      : "zor";

  const difficulty: NotalDifficulty = isValidNotalDifficulty(rawDifficulty)
    ? rawDifficulty
    : "zor";

  const creditsSupabase = createSupabaseServerClient();
  if (!creditsSupabase) {
    return NextResponse.json(
      { error: "Supabase yapılandırması eksik." },
      { status: 500 },
    );
  }

  const identity = await resolveAuthenticatedIdentity(request);
  if (!identity) {
    return notalAuthRequiredResponse();
  }

  const limited = enforceRateLimit(
    request,
    "notal-generate",
    identityRateLimitKey(identity),
    12,
    60 * 60 * 1000,
  );
  if (limited) return limited;

  const consumed = await consumeNotalCredit(creditsSupabase, identity);
  if (!consumed.ok) {
    return NextResponse.json(
      {
        error:
          "Not oluşturma hakkınız kalmadı. PDF bağışlayarak 3 hak kazanabilirsiniz.",
        code: "no_credits",
        credits: consumed.credits,
      },
      { status: 403 },
    );
  }

  const openai = new OpenAI({ apiKey });

  try {
    const [academicContext, subject] = await Promise.all([
      fetchAcademicContextForTopic(openai, topic),
      classifyNotalSubject(openai, topic),
    ]);

    const model = process.env.OPENAI_MODEL ?? CHAT_MODEL;

    const completion = await openai.chat.completions.create({
      ...buildChatOptions(model),
      messages: [
        { role: "system", content: buildNotalSystemPrompt(difficulty) },
        {
          role: "user",
          content: buildNotalUserPrompt(topic, academicContext, difficulty),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      await refundNotalCredit(creditsSupabase, identity);
      return NextResponse.json(
        { error: "Boş yanıt alındı. Lütfen tekrar dene." },
        { status: 502 },
      );
    }

    const saved = await saveNotalNote(creditsSupabase, identity, {
      title: topic,
      subject,
      depth: difficulty,
      content,
    });

    return NextResponse.json({
      noteId: saved.id,
      credits: consumed.credits,
    });
  } catch (error) {
    await refundNotalCredit(creditsSupabase, identity);
    console.error("NotAl API hatası:", error);
    return NextResponse.json(
      { error: "Not üretilemedi. Lütfen tekrar dene." },
      { status: 502 },
    );
  }
}
