import type { SupabaseClient } from "@supabase/supabase-js";

import { YKS_FIGURES_BUCKET } from "@/lib/yks-figures/constants";

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

export function buildYksFigureStoragePath(options: {
  pdfFileName: string;
  pageNumber: number;
  figureIndex: number;
}): string {
  const base = safeFileName(options.pdfFileName.replace(/\.pdf$/i, ""));
  return `meb/${base}/p${options.pageNumber}-f${options.figureIndex}.png`;
}

export async function uploadYksFigureToStorage(
  supabase: SupabaseClient,
  storagePath: string,
  pngBuffer: Buffer,
): Promise<string> {
  const { error } = await supabase.storage
    .from(YKS_FIGURES_BUCKET)
    .upload(storagePath, pngBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from(YKS_FIGURES_BUCKET)
    .getPublicUrl(storagePath);

  if (!data.publicUrl) {
    throw new Error("Figür public URL üretilemedi.");
  }

  return data.publicUrl;
}
