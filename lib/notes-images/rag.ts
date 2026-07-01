import type { SupabaseClient } from "@supabase/supabase-js";

import OpenAI from "openai";

import {

  NOTES_IMAGES_MATCH_COUNT,

  NOTES_IMAGES_MATCH_THRESHOLD,

} from "@/lib/notes-images/constants";

import { createVisualRequestEmbedding } from "@/lib/notes-images/embed";

import type { NotesImageMatch, NotesImageMetadata } from "@/lib/notes-images/types";



interface MatchNotesImagesRow {

  id: string;

  public_url: string;

  topic: string;

  sub_topic: string;

  difficulty: string;

  formula_context: string;

  description: string;

  content_text: string | null;

  metadata: NotesImageMetadata | null;

  similarity: number | null;

}



function normalizeMetadata(raw: NotesImageMetadata | null): NotesImageMetadata {

  if (!raw || typeof raw !== "object") return {};

  return raw;

}



function rowToMatch(row: MatchNotesImagesRow): NotesImageMatch {

  return {

    id: row.id,

    public_url: row.public_url,

    topic: row.topic,

    sub_topic: row.sub_topic,

    difficulty: row.difficulty,

    formula_context: row.formula_context,

    description: row.description,

    content_text: row.content_text?.trim() ?? "",

    metadata: normalizeMetadata(row.metadata),

    similarity: typeof row.similarity === "number" ? row.similarity : 0,

  };

}



/** Multi-modal RAG: content_text + görsel açıklaması embedding üzerinden arama */

export async function matchNotesImages(

  supabase: SupabaseClient,

  openai: OpenAI,

  queryText: string,

  options?: {

    threshold?: number;

    count?: number;

  },

): Promise<NotesImageMatch | null> {

  const threshold = options?.threshold ?? NOTES_IMAGES_MATCH_THRESHOLD;

  const count = options?.count ?? NOTES_IMAGES_MATCH_COUNT;



  const queryEmbedding = await createVisualRequestEmbedding(openai, queryText);



  const { data, error } = await supabase.rpc("match_notes_images", {

    query_embedding: queryEmbedding,

    match_threshold: threshold,

    match_count: count,

  });



  if (error) {

    console.error("[image-rag] match_notes_images hatası:", error);

    return null;

  }



  if (!Array.isArray(data) || !data.length) {

    return null;

  }



  const best = rowToMatch(data[0] as MatchNotesImagesRow);



  if (best.similarity < threshold) {

    return null;

  }



  return best;

}



export function buildImageMarkdownFromMatch(match: NotesImageMatch): string {

  const alt = match.description.replace(/[\[\]]/g, "").trim();

  return `![${alt}](${match.public_url})`;

}



function wantsQuestionInjection(context: string): boolean {

  return /soru|problem|örnek|alıştırma|uygulama|test/i.test(context);

}



function wantsDefinitionInjection(context: string): boolean {

  return /tanım|kavram|nedir|açıklama|formül/i.test(context);

}



function pickDefinitionText(match: NotesImageMatch): string | null {

  const fromContent = match.content_text?.trim();

  if (fromContent && fromContent.length >= 40) {

    return fromContent.length > 600

      ? `${fromContent.slice(0, 597)}...`

      : fromContent;

  }



  const summary = match.metadata.summary?.trim();

  if (summary && summary.length >= 20) {

    return summary;

  }



  return null;

}



function pickQuestions(match: NotesImageMatch, max = 2): string[] {

  const questions = Array.isArray(match.metadata.questions)

    ? match.metadata.questions.map((q) => String(q).trim()).filter(Boolean)

    : [];



  return questions.slice(0, max);

}



/**

 * Görsel + akademik bağlam enjeksiyonu:

 * Örnek Soru / Önemli Tanım blokları ile not derinliğini artırır.

 */

export function buildRichMarkdownFromMatch(

  match: NotesImageMatch,

  context: { topic: string; requestDescription: string },

): string {

  const blocks: string[] = [];

  const contextText = `${context.topic} ${context.requestDescription}`;



  blocks.push(buildImageMarkdownFromMatch(match));



  if (match.description.trim()) {

    blocks.push(`*${match.description.trim()}*`);

  }



  if (wantsDefinitionInjection(contextText)) {

    const definition = pickDefinitionText(match);

    if (definition) {

      blocks.push(`#### Önemli Tanım\n\n${definition}`);

    }

  } else if (match.content_text.trim() && match.content_text.length >= 80) {

    const snippet =

      match.content_text.length > 400

        ? `${match.content_text.slice(0, 397)}...`

        : match.content_text;

    blocks.push(`#### Bağlam\n\n${snippet}`);

  }



  const questions = pickQuestions(match);

  if (questions.length && wantsQuestionInjection(contextText)) {

    const questionLines = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");

    blocks.push(`#### Örnek Soru\n\n${questionLines}`);

  } else if (questions.length === 1) {

    blocks.push(`#### Örnek Soru\n\n${questions[0]}`);

  }



  return blocks.join("\n\n");

}


