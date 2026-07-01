import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotesImageMetadata } from "@/lib/notes-images/types";



interface InsertNotesImageParams {

  storagePath: string;

  publicUrl: string;

  topic: string;

  subTopic: string;

  difficulty: string;

  formulaContext: string;

  description: string;

  contentText: string;

  metadata: NotesImageMetadata;

  embedding: number[];

  sourcePdfName: string;

  pageNumber: number;

  width: number;

  height: number;

}



export async function insertNotesImageRecord(

  supabase: SupabaseClient,

  params: InsertNotesImageParams,

): Promise<string> {

  const labels = {

    topic: params.topic,

    sub_topic: params.subTopic,

    difficulty: params.difficulty,

    formula_context: params.formulaContext,

    description: params.description,

  };



  const { data, error } = await supabase

    .from("notes_images")

    .insert({

      storage_path: params.storagePath,

      public_url: params.publicUrl,

      topic: params.topic,

      sub_topic: params.subTopic,

      difficulty: params.difficulty,

      formula_context: params.formulaContext,

      description: params.description,

      content_text: params.contentText,

      metadata: params.metadata,

      labels,

      embedding: params.embedding,

      source_pdf_name: params.sourcePdfName,

      page_number: params.pageNumber,

      width: params.width,

      height: params.height,

      is_published: true,

    })

    .select("id")

    .single();



  if (error || !data?.id) {

    throw error ?? new Error("notes_images kaydı oluşturulamadı.");

  }



  return String(data.id);

}


