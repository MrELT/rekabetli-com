import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** İstemci tarafı Storage yüklemesi (yalnızca anon key; service_role kullanmayın). */
export function createSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const BUCKET = "academic_pdfs";

export async function uploadPdfToAcademicBucket(
  file: File,
): Promise<{ pdf_url: string; storage_path: string }> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY gerekli.");
  }

  const path = `donations/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: "application/pdf",
    upsert: false,
  });

  if (error) {
    throw new Error(error.message || "Storage yüklemesi başarısız.");
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { pdf_url: data.publicUrl, storage_path: path };
}
