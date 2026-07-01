-- YKS Metin RAG (Faz A): yks_chunks + pgvector araması
-- supabase-notal-academic-library.sql (vector extension) sonrasında çalıştırın.

CREATE TABLE IF NOT EXISTS public.yks_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_type text NOT NULL CHECK (
    chunk_type IN (
      'definition',
      'theorem',
      'explanation',
      'example',
      'question',
      'solution'
    )
  ),
  subject text NOT NULL,
  curriculum text NOT NULL CHECK (curriculum IN ('TYT', 'AYT', 'genel')),
  topic text NOT NULL DEFAULT '',
  subtopic text NOT NULL DEFAULT '',
  content text NOT NULL,
  source_name text,
  source_pdf text,
  page_start integer,
  page_end integer,
  difficulty text NOT NULL DEFAULT 'orta',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding extensions.vector(1536),
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT yks_chunks_content_not_blank CHECK (char_length(trim(content)) > 0)
);

COMMENT ON TABLE public.yks_chunks IS
  'YKS metin RAG: kitap kesitleri, tanımlar, örnekler ve sorular (Faz A).';

CREATE INDEX IF NOT EXISTS yks_chunks_subject_idx ON public.yks_chunks (subject);
CREATE INDEX IF NOT EXISTS yks_chunks_curriculum_idx ON public.yks_chunks (curriculum);
CREATE INDEX IF NOT EXISTS yks_chunks_topic_idx ON public.yks_chunks (topic);
CREATE INDEX IF NOT EXISTS yks_chunks_published_idx
  ON public.yks_chunks (is_published)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS yks_chunks_embedding_hnsw_idx
  ON public.yks_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE public.yks_chunks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.match_yks_chunks(
  query_embedding extensions.vector(1536),
  filter_subject text DEFAULT NULL,
  filter_curriculum text DEFAULT NULL,
  match_threshold double precision DEFAULT 0.72,
  match_count integer DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  chunk_type text,
  subject text,
  curriculum text,
  topic text,
  subtopic text,
  content text,
  source_name text,
  page_start integer,
  page_end integer,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    yc.id,
    yc.chunk_type,
    yc.subject,
    yc.curriculum,
    yc.topic,
    yc.subtopic,
    yc.content,
    yc.source_name,
    yc.page_start,
    yc.page_end,
    (1 - (yc.embedding <=> query_embedding))::double precision AS similarity
  FROM public.yks_chunks AS yc
  WHERE yc.is_published = true
    AND yc.embedding IS NOT NULL
    AND (filter_subject IS NULL OR yc.subject ILIKE filter_subject)
    AND (
      filter_curriculum IS NULL
      OR filter_curriculum = 'genel'
      OR yc.curriculum = filter_curriculum
      OR yc.curriculum = 'genel'
    )
    AND (1 - (yc.embedding <=> query_embedding)) >= match_threshold
  ORDER BY yc.embedding <=> query_embedding
  LIMIT GREATEST(match_count, 1);
$$;

COMMENT ON FUNCTION public.match_yks_chunks(
  extensions.vector, text, text, double precision, integer
) IS 'NotAl retrieve: YKS metin chunk cosine araması.';

GRANT EXECUTE ON FUNCTION public.match_yks_chunks(
  extensions.vector, text, text, double precision, integer
) TO service_role;
