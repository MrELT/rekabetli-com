-- NotAl not geri bildirimi (1–5 fayda puanı + yorum)
-- supabase-notal-saved-notes.sql sonrasında bir kez çalıştırın.

CREATE TABLE IF NOT EXISTS public.notal_note_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.notal_saved_notes (id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  visitor_id text,
  score smallint CHECK (score IS NULL OR (score >= 1 AND score <= 5)),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notal_note_feedback_owner_check CHECK (
    user_id IS NOT NULL
    OR (visitor_id IS NOT NULL AND char_length(trim(visitor_id)) > 0)
  ),
  CONSTRAINT notal_note_feedback_has_content CHECK (
    score IS NOT NULL
    OR (comment IS NOT NULL AND char_length(trim(comment)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS notal_note_feedback_note_user_idx
  ON public.notal_note_feedback (note_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notal_note_feedback_note_visitor_idx
  ON public.notal_note_feedback (note_id, visitor_id)
  WHERE user_id IS NULL AND visitor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notal_note_feedback_note_id_idx
  ON public.notal_note_feedback (note_id, created_at DESC);

COMMENT ON TABLE public.notal_note_feedback IS
  'NotAl notları için faydalılık puanı (1–5) ve serbest metin geri bildirim.';

ALTER TABLE public.notal_note_feedback ENABLE ROW LEVEL SECURITY;

-- Admin: tüm notlar ve geri bildirimler
DROP POLICY IF EXISTS "notal_saved_notes_select_admin" ON public.notal_saved_notes;
CREATE POLICY "notal_saved_notes_select_admin"
ON public.notal_saved_notes
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

DROP POLICY IF EXISTS "notal_note_feedback_select_admin" ON public.notal_note_feedback;
CREATE POLICY "notal_note_feedback_select_admin"
ON public.notal_note_feedback
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));
