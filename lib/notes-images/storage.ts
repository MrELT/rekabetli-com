import type { SupabaseClient } from "@supabase/supabase-js";
import { NOTES_IMAGES_BUCKET } from "@/lib/notes-images/constants";
import type { PdfExtractedImage } from "@/lib/notes-images/types";

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

export function buildNotesImageStoragePath(options: {
  pdfFileName: string;
  pageNumber: number;
  imageIndex: number;
  extension: "png" | "jpg";
}): string {
  const base = safeFileName(options.pdfFileName.replace(/\.pdf$/i, ""));
  return `meb/${base}/p${options.pageNumber}-i${options.imageIndex}.${options.extension}`;
}

export async function uploadNotesImageToStorage(
  supabase: SupabaseClient,
  storagePath: string,
  image: PdfExtractedImage,
): Promise<string> {
  const { error } = await supabase.storage
    .from(NOTES_IMAGES_BUCKET)
    .upload(storagePath, image.buffer, {
      contentType: image.mimeType,
      upsert: true,
    });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage
    .from(NOTES_IMAGES_BUCKET)
    .getPublicUrl(storagePath);

  if (!data.publicUrl) {
    throw new Error("Görsel public URL üretilemedi.");
  }

  return data.publicUrl;
}
