-- Admin: tüm toplulukları listeleyebilsin
DROP POLICY IF EXISTS "communities_select_admin" ON public.communities;
CREATE POLICY "communities_select_admin"
ON public.communities
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));
