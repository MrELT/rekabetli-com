-- Topluluk e-posta bildirim tercihi (üye bazlı)
-- Site içi bildirimler değişmez; yalnızca e-posta gönderimi etkilenir.
-- Supabase SQL Editor'da bir kez çalıştırın.

ALTER TABLE public.community_members
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.community_members.email_notifications_enabled IS
  'false ise community_post e-postası gönderilmez; site içi bildirim devam eder.';

-- Üye kendi tercih satırını güncelleyebilsin
DROP POLICY IF EXISTS "community_members_update_own_email_pref" ON public.community_members;

CREATE POLICY "community_members_update_own_email_pref"
ON public.community_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid ())
WITH CHECK (user_id = auth.uid ());
