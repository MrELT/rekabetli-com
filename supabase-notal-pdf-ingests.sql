-- NotAl: PDF bağışı tamamlama kaydı (grant köprüsü)
-- supabase-notal-demo-credits.sql sonrasında bir kez çalıştırın.

CREATE TABLE IF NOT EXISTS public.notal_pdf_ingests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_key text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  visitor_id text,
  total_chunks integer NOT NULL CHECK (total_chunks > 0),
  chunks_embedded integer NOT NULL DEFAULT 0 CHECK (chunks_embedded >= 0),
  pdf_url text,
  title text,
  completed_at timestamptz,
  grant_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notal_pdf_ingests_owner_check CHECK (
    user_id IS NOT NULL
    OR (visitor_id IS NOT NULL AND char_length(trim(visitor_id)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS notal_pdf_ingests_key_user_idx
  ON public.notal_pdf_ingests (ingest_key, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notal_pdf_ingests_key_visitor_idx
  ON public.notal_pdf_ingests (ingest_key, visitor_id)
  WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS notal_pdf_ingests_created_idx
  ON public.notal_pdf_ingests (created_at DESC);

COMMENT ON TABLE public.notal_pdf_ingests IS
  'PDF embed tamamlanınca not hakkı grant için doğrulama kaydı.';

ALTER TABLE public.notal_pdf_ingests ENABLE ROW LEVEL SECURITY;
