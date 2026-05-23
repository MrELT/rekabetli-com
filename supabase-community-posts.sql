-- Topluluk akışı: posts tablosuna community_id
-- supabase-communities.sql ve supabase-community-join-requests.sql sonrasında çalıştırın.

ALTER TABLE public.posts
ADD COLUMN IF NOT EXISTS community_id uuid REFERENCES public.communities (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS posts_community_id_created_idx
ON public.posts (community_id, created_at DESC)
WHERE community_id IS NOT NULL;

-- Üyeler gizli topluluğu görebilsin (RLS döngüsünü önlemek için helper fonksiyon)
CREATE OR REPLACE FUNCTION public.is_community_member (p_community_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.community_members m
    WHERE m.community_id = p_community_id
      AND m.user_id = auth.uid ()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_community_owner (p_community_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.communities c
    WHERE c.id = p_community_id
      AND c.owner_id = auth.uid ()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_community_member (uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_community_owner (uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_community_public (p_community_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.communities c
    WHERE c.id = p_community_id
      AND c.visibility = 'public'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_community_public (uuid) TO authenticated, anon;

DROP POLICY IF EXISTS "communities_select_as_member" ON public.communities;

CREATE POLICY "communities_select_as_member"
ON public.communities
FOR SELECT
TO authenticated
USING (public.is_community_member (id));

DROP POLICY IF EXISTS "community_members_insert_self" ON public.community_members;

CREATE POLICY "community_members_insert_self"
ON public.community_members
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid ()
  AND (
    public.is_community_public (community_id)
    OR public.is_community_owner (community_id)
  )
);
