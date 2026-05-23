-- Üyeler birbirini görsün; kurucu üye kaldırabilsin
-- supabase-community-rls-fix.sql sonrasında bir kez çalıştırın.

CREATE OR REPLACE FUNCTION public.is_community_owner_user (
  p_community_id uuid,
  p_user_id uuid
)
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
      AND c.owner_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_community_owner_user (uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "community_members_select_as_member" ON public.community_members;

CREATE POLICY "community_members_select_as_member"
ON public.community_members
FOR SELECT
TO authenticated
USING (public.is_community_member (community_id));

DROP POLICY IF EXISTS "community_members_delete_as_owner" ON public.community_members;

CREATE POLICY "community_members_delete_as_owner"
ON public.community_members
FOR DELETE
TO authenticated
USING (
  public.is_community_owner (community_id)
  AND NOT public.is_community_owner_user (community_id, user_id)
);
