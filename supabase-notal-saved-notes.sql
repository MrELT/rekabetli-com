-- NotAl: kaydedilmiş notlar (konu, alan, derinlik)
-- supabase-notal-demo-credits.sql sonrasında bir kez çalıştırın.

CREATE TABLE IF NOT EXISTS public.notal_saved_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  visitor_id text,
  title text NOT NULL,
  subject text NOT NULL,
  depth text NOT NULL CHECK (depth IN ('kolay', 'orta', 'zor')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notal_saved_notes_owner_check CHECK (
    user_id IS NOT NULL OR (visitor_id IS NOT NULL AND char_length(trim(visitor_id)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS notal_saved_notes_user_id_idx
  ON public.notal_saved_notes (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notal_saved_notes_visitor_id_idx
  ON public.notal_saved_notes (visitor_id, created_at DESC)
  WHERE visitor_id IS NOT NULL;

COMMENT ON TABLE public.notal_saved_notes IS
  'NotAl ile üretilen notlar; alan (subject) ve derinlik (kolay= yüzeysel, zor= derin).';

ALTER TABLE public.notal_saved_notes ENABLE ROW LEVEL SECURITY;
