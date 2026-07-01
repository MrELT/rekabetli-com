-- Academic Ingestion Pipeline: notes_images genişletmesi
-- supabase-notal-notes-images.sql sonrasında çalıştırın.

ALTER TABLE public.notes_images
  ADD COLUMN IF NOT EXISTS content_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.notes_images.content_text IS
  'Görselin altındaki/yanındaki rafine akademik metin (Gemini text_content).';

COMMENT ON COLUMN public.notes_images.metadata IS
  'Akademik bağlam: summary, questions, visual_type, page_context vb.';

CREATE INDEX IF NOT EXISTS notes_images_metadata_gin_idx
  ON public.notes_images
  USING gin (metadata);

-- Dönüş tipi değiştiği için önce eski fonksiyonu kaldır (CREATE OR REPLACE yetmez)
DROP FUNCTION IF EXISTS public.match_notes_images(extensions.vector, double precision, integer);

-- Multi-modal RAG: content_text + metadata döndür
CREATE FUNCTION public.match_notes_images(
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
  'NotAl illustrator: görsel açıklama + content_text embedding ile multi-modal RAG araması.';

GRANT EXECUTE ON FUNCTION public.match_notes_images(extensions.vector, double precision, integer)
  TO service_role;
