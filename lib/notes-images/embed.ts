import OpenAI from "openai";

import { NOTES_IMAGES_EMBEDDING_MODEL } from "@/lib/notes-images/constants";

import { buildLabelEmbeddingText } from "@/lib/notes-images/label-schema";

import type {

  AcademicEmbeddingInput,

  NotesImageLabel,

} from "@/lib/notes-images/types";



export function buildAcademicEmbeddingText(

  input: AcademicEmbeddingInput,

): string {

  const questions = Array.isArray(input.metadata.questions)

    ? input.metadata.questions.filter(Boolean).join("\n")

    : "";



  const parts = [

    `Açıklama: ${input.description}`,

    input.contentText ? `İçerik metni: ${input.contentText}` : "",

    input.metadata.summary ? `Özet: ${input.metadata.summary}` : "",

    questions ? `Sorular:\n${questions}` : "",

  ].filter(Boolean);



  return parts.join("\n\n");

}



export async function createAcademicNotesImageEmbedding(

  openai: OpenAI,

  input: AcademicEmbeddingInput,

): Promise<number[]> {

  const text = buildAcademicEmbeddingText(input);



  const response = await openai.embeddings.create({

    model: NOTES_IMAGES_EMBEDDING_MODEL,

    input: text,

  });



  const embedding = response.data[0]?.embedding;

  if (!embedding?.length) {

    throw new Error("Akademik içerik embedding oluşturulamadı.");

  }



  return embedding;

}



/** @deprecated Vision etiketleme pipeline — geriye dönük uyumluluk */

export async function createNotesImageEmbedding(

  openai: OpenAI,

  label: NotesImageLabel,

): Promise<number[]> {

  const input = buildLabelEmbeddingText(label);



  const response = await openai.embeddings.create({

    model: NOTES_IMAGES_EMBEDDING_MODEL,

    input,

  });



  const embedding = response.data[0]?.embedding;

  if (!embedding?.length) {

    throw new Error("Görsel embedding oluşturulamadı.");

  }



  return embedding;

}



export async function createVisualRequestEmbedding(

  openai: OpenAI,

  query: string,

): Promise<number[]> {

  const response = await openai.embeddings.create({

    model: NOTES_IMAGES_EMBEDDING_MODEL,

    input: query.trim(),

  });



  const embedding = response.data[0]?.embedding;

  if (!embedding?.length) {

    throw new Error("Sorgu embedding oluşturulamadı.");

  }



  return embedding;

}


