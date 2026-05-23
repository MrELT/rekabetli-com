-- Kendi yanıtlarını silme izni
-- Supabase SQL Editor'da çalıştırın.

ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_delete_own" ON public.comments;

CREATE POLICY "comments_delete_own"
ON public.comments
FOR DELETE
TO authenticated
USING (auth.uid () = user_id);
