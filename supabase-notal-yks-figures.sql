-- YKS Görsel RAG (Faz B): sayfa render + figür crop + chunk eşleştirme
-- supabase-notal-yks-chunks.sql sonrasında çalıştırın.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'yks_figures',
  'yks_figures',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "yks_figures_public_read" ON storage.objects;
CREATE POLICY "yks_figures_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'yks_figures');

DROP POLICY IF EXISTS "yks_figures_service_insert" ON storage.objects;
CREATE POLICY "yks_figures_service_insert"
ON storage.objects FOR INSERT
TO authenticated, service_role
WITH CHECK (bucket_id = 'yks_figures');

CREATE TABLE IF NOT EXISTS public.yks_figures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  figure_type text NOT NULL CHECK (
    figure_type IN (
      'diagram',
      'graph',
      'table',
      'question',
      'photo',
      'other'
    )
  ),
  subject text NOT NULL DEFAULT '',
  curriculum text NOT NULL DEFAULT 'genel',
  topic text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  storage_path text NOT NULL,
  public_url text NOT NULL,
  source_pdf text,
  source_name text,
  page_number integer NOT NULL,
  bbox jsonb NOT NULL DEFAULT '[]'::jsonb,
  width integer,
  height integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding extensions.vector(1536),
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT yks_figures_caption_not_blank CHECK (char_length(trim(caption)) > 0)
);

COMMENT ON TABLE public.yks_figures IS
  'Faz B: PDF sayfa renderından kırpılan figürler ve soru blokları.';

CREATE INDEX IF NOT EXISTS yks_figures_page_idx
  ON public.yks_figures (source_pdf, page_number);

CREATE INDEX IF NOT EXISTS yks_figures_topic_idx ON public.yks_figures (topic);

CREATE INDEX IF NOT EXISTS yks_figures_published_idx
  ON public.yks_figures (is_published)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS yks_figures_embedding_hnsw_idx
  ON public.yks_figures
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS public.yks_chunk_figures (
  chunk_id uuid NOT NULL REFERENCES public.yks_chunks (id) ON DELETE CASCADE,
  figure_id uuid NOT NULL REFERENCES public.yks_figures (id) ON DELETE CASCADE,
  link_score double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, figure_id)
);

COMMENT ON TABLE public.yks_chunk_figures IS
  'Faz B: metin chunk ile figür arasındaki sayfa/konu eşleştirmesi.';

CREATE INDEX IF NOT EXISTS yks_chunk_figures_figure_idx
  ON public.yks_chunk_figures (figure_id);

ALTER TABLE public.yks_figures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yks_chunk_figures ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.match_yks_figures(
  query_embedding extensions.vector(1536),
  filter_subject text DEFAULT NULL,
  filter_curriculum text DEFAULT NULL,
  match_threshold double precision DEFAULT 0.72,
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  figure_type text,
  subject text,
  curriculum text,
  topic text,
  caption text,
  public_url text,
  page_number integer,
  source_name text,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    yf.id,
    yf.figure_type,
    yf.subject,
    yf.curriculum,
    yf.topic,
    yf.caption,
    yf.public_url,
    yf.page_number,
    yf.source_name,
    (1 - (yf.embedding <=> query_embedding))::double precision AS similarity
  FROM public.yks_figures AS yf
  WHERE yf.is_published = true
    AND yf.embedding IS NOT NULL
    AND (filter_subject IS NULL OR yf.subject ILIKE filter_subject)
    AND (
      filter_curriculum IS NULL
      OR filter_curriculum = 'genel'
      OR yf.curriculum = filter_curriculum
      OR yf.curriculum = 'genel'
    )
    AND (1 - (yf.embedding <=> query_embedding)) >= match_threshold
  ORDER BY yf.embedding <=> query_embedding
  LIMIT GREATEST(match_count, 1);
$$;

CREATE OR REPLACE FUNCTION public.match_yks_figures_for_chunks(
  query_embedding extensions.vector(1536),
  chunk_ids uuid[],
  match_threshold double precision DEFAULT 0.65,
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  figure_type text,
  subject text,
  topic text,
  caption text,
  public_url text,
  page_number integer,
  link_score double precision,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    yf.id,
    yf.figure_type,
    yf.subject,
    yf.topic,
    yf.caption,
    yf.public_url,
    yf.page_number,
    cf.link_score,
    (1 - (yf.embedding <=> query_embedding))::double precision AS similarity
  FROM public.yks_chunk_figures AS cf
  INNER JOIN public.yks_figures AS yf ON yf.id = cf.figure_id
  WHERE cf.chunk_id = ANY(chunk_ids)
    AND yf.is_published = true
    AND yf.embedding IS NOT NULL
    AND (1 - (yf.embedding <=> query_embedding)) >= match_threshold
  ORDER BY (cf.link_score * 0.4 + (1 - (yf.embedding <=> query_embedding)) * 0.6) DESC
  LIMIT GREATEST(match_count, 1);
$$;

GRANT EXECUTE ON FUNCTION public.match_yks_figures(
  extensions.vector, text, text, double precision, integer
) TO service_role;

GRANT EXECUTE ON FUNCTION public.match_yks_figures_for_chunks(
  extensions.vector, uuid[], double precision, integer
) TO service_role;
