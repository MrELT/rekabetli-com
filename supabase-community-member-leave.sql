-- Üyenin kendi isteğiyle topluluktan ayrılması
-- Supabase SQL Editor'da bir kez çalıştırın.

DROP POLICY IF EXISTS "community_members_delete_self" ON public.community_members;

CREATE POLICY "community_members_delete_self"
ON public.community_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid ());

DROP POLICY IF EXISTS "join_requests_delete_own" ON public.community_join_requests;

CREATE POLICY "join_requests_delete_own"
ON public.community_join_requests
FOR DELETE
TO authenticated
USING (user_id = auth.uid ());
