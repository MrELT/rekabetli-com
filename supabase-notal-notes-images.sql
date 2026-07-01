-- NotAl Görsel RAG: MEB kitap PDF'lerinden ayıklanan görseller + pgvector
-- supabase-notal-academic-library.sql (vector extension) sonrasında çalıştırın.

-- ---------------------------------------------------------------------------
-- Storage: notes_images bucket (çıkarılan şekil/grafik PNG'leri)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'notes_images',
  'notes_images',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "notes_images_public_read" ON storage.objects;
CREATE POLICY "notes_images_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'notes_images');

DROP POLICY IF EXISTS "notes_images_service_insert" ON storage.objects;
CREATE POLICY "notes_images_service_insert"
ON storage.objects FOR INSERT
TO authenticated, service_role
WITH CHECK (bucket_id = 'notes_images');

-- ---------------------------------------------------------------------------
-- Tablo: notes_images
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notes_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL,
  public_url text NOT NULL,
  topic text NOT NULL,
  sub_topic text NOT NULL DEFAULT '',
  difficulty text NOT NULL DEFAULT 'orta',
  formula_context text NOT NULL DEFAULT '',
  description text NOT NULL,
  content_text text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding extensions.vector(1536),
  source_pdf_name text,
  page_number integer,
  width integer,
  height integer,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notes_images_description_not_blank CHECK (char_length(trim(description)) > 0)
);

COMMENT ON TABLE public.notes_images IS
  'MEB kitap PDF görselleri: Vision etiketleme + pgvector RAG (illustrator düğümü).';

CREATE INDEX IF NOT EXISTS notes_images_topic_idx
  ON public.notes_images (topic);

CREATE INDEX IF NOT EXISTS notes_images_published_idx
  ON public.notes_images (is_published)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS notes_images_embedding_hnsw_idx
  ON public.notes_images
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE public.notes_images ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Cosine similarity araması (illustrator RAG)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_notes_images(
  query_embedding extensions.vector(1536),
  match_threshold double precision DEFAULT 0.8,
  match_count integer DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  public_url text,
  topic text,
  sub_topic text,
  difficulty text,
  formula_context text,
  description text,
  content_text text,
  metadata jsonb,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    ni.id,
    ni.public_url,
    ni.topic,
    ni.sub_topic,
    ni.difficulty,
    ni.formula_context,
    ni.description,
    ni.content_text,
    ni.metadata,
    (1 - (ni.embedding <=> query_embedding))::double precision AS similarity
  FROM public.notes_images AS ni
  WHERE ni.is_published = true
    AND ni.embedding IS NOT NULL
    AND (1 - (ni.embedding <=> query_embedding)) >= match_threshold
  ORDER BY ni.embedding <=> query_embedding
  LIMIT GREATEST(match_count, 1);
$$;

COMMENT ON FUNCTION public.match_notes_images(extensions.vector, double precision, integer) IS
  'NotAl illustrator: görsel etiket embedding ile cosine similarity araması.';

GRANT EXECUTE ON FUNCTION public.match_notes_images(extensions.vector, double precision, integer)
  TO service_role;
