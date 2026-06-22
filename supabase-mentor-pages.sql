-- Mentör vitrin sayfası (banner, fotoğraf, hakkında)
-- supabase-admin-panel.sql (is_mentor) sonrasında bir kez çalıştırın.

CREATE TABLE IF NOT EXISTS public.mentor_pages (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  banner_url text,
  photo_url text,
  about text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_pages_about_len CHECK (
    about IS NULL OR char_length(trim(about)) <= 3000
  )
);

CREATE INDEX IF NOT EXISTS mentor_pages_updated_idx
ON public.mentor_pages (updated_at DESC);

COMMENT ON TABLE public.mentor_pages IS
  'Mentör vitrin sayfası: banner, vitrin fotoğrafı ve hakkında metni.';

ALTER TABLE public.mentor_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_pages_select_public" ON public.mentor_pages;
CREATE POLICY "mentor_pages_select_public"
ON public.mentor_pages
FOR SELECT
TO authenticated, anon
USING (true);

DROP POLICY IF EXISTS "mentor_pages_insert_own_mentor" ON public.mentor_pages;
CREATE POLICY "mentor_pages_insert_own_mentor"
ON public.mentor_pages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid () = user_id
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid ()
      AND p.is_mentor = true
  )
);

DROP POLICY IF EXISTS "mentor_pages_update_own_mentor" ON public.mentor_pages;
CREATE POLICY "mentor_pages_update_own_mentor"
ON public.mentor_pages
FOR UPDATE
TO authenticated
USING (
  auth.uid () = user_id
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid ()
      AND p.is_mentor = true
  )
)
WITH CHECK (
  auth.uid () = user_id
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid ()
      AND p.is_mentor = true
  )
);

DROP POLICY IF EXISTS "mentor_pages_select_admin" ON public.mentor_pages;
CREATE POLICY "mentor_pages_select_admin"
ON public.mentor_pages
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));
