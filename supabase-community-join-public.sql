-- Açık topluluklara doğrudan üyelik (Topluluğa Katıl)
-- supabase-community-rls-fix.sql sonrasında bir kez çalıştırın.

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
