-- NotAl demo not hakları (PDF bağışı → 3 hak, en fazla 5 paket)
-- Supabase SQL Editor'da bir kez çalıştırın.

CREATE TABLE IF NOT EXISTS public.notal_user_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  visitor_id text UNIQUE,
  notes_remaining integer NOT NULL DEFAULT 0 CHECK (notes_remaining >= 0 AND notes_remaining <= 3),
  pdf_grant_count integer NOT NULL DEFAULT 0 CHECK (pdf_grant_count >= 0 AND pdf_grant_count <= 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notal_user_credits_identity_check CHECK (
    user_id IS NOT NULL OR (visitor_id IS NOT NULL AND char_length(trim(visitor_id)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS notal_user_credits_visitor_id_idx
  ON public.notal_user_credits (visitor_id)
  WHERE visitor_id IS NOT NULL;

COMMENT ON TABLE public.notal_user_credits IS
  'NotAl demo: PDF başına 3 not hakkı, en fazla 5 paket (15 not üst sınırı pratikte 5x3 yenileme).';

CREATE OR REPLACE FUNCTION public.set_notal_user_credits_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notal_user_credits_set_updated_at ON public.notal_user_credits;
CREATE TRIGGER notal_user_credits_set_updated_at
BEFORE UPDATE ON public.notal_user_credits
FOR EACH ROW
EXECUTE FUNCTION public.set_notal_user_credits_updated_at();

ALTER TABLE public.notal_user_credits ENABLE ROW LEVEL SECURITY;

-- Doğrudan tablo erişimi kapalı; yalnızca service_role API route'ları
