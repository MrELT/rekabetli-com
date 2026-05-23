-- RLS sonsuz döngü düzeltmesi
-- Hata: "infinite recursion detected in policy for relation communities"
-- Sebep: communities ↔ community_members politikaları birbirini tetikliyor.
-- Supabase SQL Editor'da bir kez çalıştırın (diğer community SQL'lerinden sonra).

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

-- communities: üye olarak görüntüleme
DROP POLICY IF EXISTS "communities_select_as_member" ON public.communities;

CREATE POLICY "communities_select_as_member"
ON public.communities
FOR SELECT
TO authenticated
USING (public.is_community_member (id));

-- community_members: kurucu üye listesini görsün
DROP POLICY IF EXISTS "community_members_select_as_owner" ON public.community_members;

CREATE POLICY "community_members_select_as_owner"
ON public.community_members
FOR SELECT
TO authenticated
USING (public.is_community_owner (community_id));

-- join_requests: kurucu politikaları (communities alt sorgusu kaldırıldı)
DROP POLICY IF EXISTS "join_requests_select_as_owner" ON public.community_join_requests;
DROP POLICY IF EXISTS "join_requests_insert_own" ON public.community_join_requests;
DROP POLICY IF EXISTS "join_requests_update_as_owner" ON public.community_join_requests;

CREATE POLICY "join_requests_select_as_owner"
ON public.community_join_requests
FOR SELECT
TO authenticated
USING (public.is_community_owner (community_id));

CREATE POLICY "join_requests_insert_own"
ON public.community_join_requests
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid ()
  AND NOT public.is_community_owner (community_id)
  AND NOT public.is_community_member (community_id)
);

CREATE POLICY "join_requests_update_as_owner"
ON public.community_join_requests
FOR UPDATE
TO authenticated
USING (public.is_community_owner (community_id))
WITH CHECK (public.is_community_owner (community_id));
