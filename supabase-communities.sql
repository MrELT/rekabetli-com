-- Topluluklar tablosu ve okuma/yazma politikaları
-- Supabase SQL Editor'da çalıştırın.

CREATE TABLE IF NOT EXISTS public.communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  avatar_url text,
  purpose text NOT NULL CHECK (char_length(trim(purpose)) >= 10),
  size_band text NOT NULL CHECK (size_band IN ('0-10', '10-50', '50-100', '100+')),
  visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS communities_owner_id_idx ON public.communities (owner_id);
CREATE INDEX IF NOT EXISTS communities_visibility_created_idx ON public.communities (visibility, created_at DESC);

ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "communities_select_public" ON public.communities;
DROP POLICY IF EXISTS "communities_select_own" ON public.communities;
DROP POLICY IF EXISTS "communities_insert_own" ON public.communities;
DROP POLICY IF EXISTS "communities_update_own" ON public.communities;
DROP POLICY IF EXISTS "communities_delete_own" ON public.communities;

CREATE POLICY "communities_select_public"
ON public.communities
FOR SELECT
TO authenticated, anon
USING (visibility = 'public');

CREATE POLICY "communities_select_own"
ON public.communities
FOR SELECT
TO authenticated
USING (owner_id = auth.uid ());

CREATE POLICY "communities_insert_own"
ON public.communities
FOR INSERT
TO authenticated
WITH CHECK (owner_id = auth.uid ());

CREATE POLICY "communities_update_own"
ON public.communities
FOR UPDATE
TO authenticated
USING (owner_id = auth.uid ())
WITH CHECK (owner_id = auth.uid ());

CREATE POLICY "communities_delete_own"
ON public.communities
FOR DELETE
TO authenticated
USING (owner_id = auth.uid ());
