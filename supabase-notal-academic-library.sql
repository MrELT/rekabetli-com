-- NotAl RAG: akademik kütüphane (kitap, sunum, çıkmış soru, makale) + pgvector araması
-- Supabase SQL Editor'da bir kez çalıştırın.
--
-- Gereksinimler (.env.local):
--   SUPABASE_URL
--   SUPABASE_SERVICE_ROLE_KEY  (NotAl API route sunucu tarafı araması)
--   OPENAI_API_KEY             (text-embedding-3-small, 1536 boyut)
--
-- API: app/api/notal/route.ts → rpc('match_academic_library', ...)

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Tablo: academic_library_chunks
-- Her satır = bir kaynak parçası (kitap bölümü, slayt notu, soru+çözüm, makale alıntısı)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.academic_library_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (
    source_type IN ('book', 'presentation', 'exam_question', 'article')
  ),
  source_name text,
  title text,
  content text NOT NULL,
  subject text,
  language text NOT NULL DEFAULT 'tr',
  page_number integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding extensions.vector(1536),
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_library_chunks_content_not_blank CHECK (char_length(trim(content)) > 0)
);

COMMENT ON TABLE public.academic_library_chunks IS
  'NotAl RAG arşivi: kitap kesitleri, sunum notları, çıkmış sorular ve makale parçaları.';
COMMENT ON COLUMN public.academic_library_chunks.source_type IS
  'book | presentation | exam_question | article';
COMMENT ON COLUMN public.academic_library_chunks.embedding IS
  'OpenAI text-embedding-3-small (1536) vektörü';

CREATE INDEX IF NOT EXISTS academic_library_chunks_source_type_idx
  ON public.academic_library_chunks (source_type);

CREATE INDEX IF NOT EXISTS academic_library_chunks_subject_idx
  ON public.academic_library_chunks (subject);

CREATE INDEX IF NOT EXISTS academic_library_chunks_published_idx
  ON public.academic_library_chunks (is_published)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS academic_library_chunks_embedding_hnsw_idx
  ON public.academic_library_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ---------------------------------------------------------------------------
-- updated_at tetikleyicisi
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_academic_library_chunks_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS academic_library_chunks_set_updated_at
  ON public.academic_library_chunks;

CREATE TRIGGER academic_library_chunks_set_updated_at
BEFORE UPDATE ON public.academic_library_chunks
FOR EACH ROW
EXECUTE FUNCTION public.set_academic_library_chunks_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: doğrudan tablo okuması kapalı; arama yalnızca RPC üzerinden
-- service_role RLS'i bypass eder (NotAl API route ingestion/okuma için)
-- ---------------------------------------------------------------------------

ALTER TABLE public.academic_library_chunks ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Vektör benzerlik araması (cosine)
-- Dönüş alanları app/api/notal/route.ts ile uyumlu:
--   id, content, source_type, title, source_name, similarity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_academic_library(
  query_embedding extensions.vector(1536),
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  content text,
  source_type text,
  title text,
  source_name text,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    alc.id,
    alc.content,
    alc.source_type,
    alc.title,
    alc.source_name,
    (1 - (alc.embedding <=> query_embedding))::double precision AS similarity
  FROM public.academic_library_chunks AS alc
  WHERE alc.is_published = true
    AND alc.embedding IS NOT NULL
    AND (1 - (alc.embedding <=> query_embedding)) > match_threshold
  ORDER BY alc.embedding <=> query_embedding
  LIMIT GREATEST(match_count, 1);
$$;

COMMENT ON FUNCTION public.match_academic_library(extensions.vector, double precision, integer) IS
  'NotAl RAG: konu embedding''i ile en alakalı akademik kaynak parçalarını döner.';

GRANT EXECUTE ON FUNCTION public.match_academic_library(extensions.vector, double precision, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Yardımcı: embedding ile kayıt ekleme/güncelleme (ingestion scriptleri için)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_academic_library_chunk(
  p_source_type text,
  p_content text,
  p_embedding extensions.vector(1536),
  p_source_name text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_subject text DEFAULT NULL,
  p_language text DEFAULT 'tr',
  p_page_number integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_is_published boolean DEFAULT true,
  p_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_source_type NOT IN ('book', 'presentation', 'exam_question', 'article') THEN
    RAISE EXCEPTION 'Gecersiz source_type: %', p_source_type;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.academic_library_chunks (
      source_type,
      source_name,
      title,
      content,
      subject,
      language,
      page_number,
      metadata,
      embedding,
      is_published
    )
    VALUES (
      p_source_type,
      p_source_name,
      p_title,
      p_content,
      p_subject,
      p_language,
      p_page_number,
      COALESCE(p_metadata, '{}'::jsonb),
      p_embedding,
      COALESCE(p_is_published, true)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.academic_library_chunks
    SET
      source_type = p_source_type,
      source_name = p_source_name,
      title = p_title,
      content = p_content,
      subject = p_subject,
      language = p_language,
      page_number = p_page_number,
      metadata = COALESCE(p_metadata, '{}'::jsonb),
      embedding = p_embedding,
      is_published = COALESCE(p_is_published, true),
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Kayit bulunamadi: %', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_academic_library_chunk(
  text, text, extensions.vector, text, text, text, text, integer, jsonb, boolean, uuid
) TO service_role;

-- ---------------------------------------------------------------------------
-- Ornek veri (istege bagli — test icin yorumu kaldirin)
-- Gercek embedding'ler OpenAI text-embedding-3-small ile uretilmelidir.
-- ---------------------------------------------------------------------------

-- INSERT INTO public.academic_library_chunks (
--   source_type, source_name, title, content, subject, embedding
-- ) VALUES (
--   'book',
--   'Kleppner & Kolenkow — Mechanics',
--   'Kepler Kanunlari',
--   'Kepler''in ucuncu kanunu: T^2 orantili a^3. Elips yorungede alan hizi sabittir.',
--   'physics',
--   NULL  -- ingestion sirasinda gercek vektor atanir
-- );
