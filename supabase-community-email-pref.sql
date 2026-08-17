-- Topluluk e-posta bildirim tercihi (üye bazlı)
-- Site içi bildirimler değişmez; yalnızca e-posta gönderimi etkilenir.
-- Güvenle tekrar çalıştırılabilir.

ALTER TABLE public.community_members
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.community_members.email_notifications_enabled IS
  'false ise bu topluluğa ait bildirim e-postası gönderilmez; site içi bildirim devam eder.';

-- Üyelik satırına doğrudan UPDATE yok: community_id değiştirilerek
-- özel topluluğa katılma bypass'ı açılmasın. Tercih yalnızca
-- set_community_email_notifications (SECURITY DEFINER) ile yazılır.
GRANT SELECT, INSERT, DELETE ON TABLE public.community_members TO authenticated;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.community_members FROM PUBLIC;
REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.community_members FROM anon, authenticated;

DROP POLICY IF EXISTS "community_members_update_own_email_pref" ON public.community_members;

CREATE OR REPLACE FUNCTION public.community_members_protect_identity ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.community_id IS DISTINCT FROM OLD.community_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'community_member_identity_immutable';
  END IF;

  NEW.joined_at := OLD.joined_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS community_members_protect_identity ON public.community_members;

CREATE TRIGGER community_members_protect_identity
BEFORE UPDATE ON public.community_members
FOR EACH ROW
EXECUTE FUNCTION public.community_members_protect_identity ();

-- ---------------------------------------------------------------------------
-- Tercih okuma: üye satırı yoksa varsayılan açık (true).
-- false → e-posta yok.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_community_email_enabled (
  p_community_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_community_id IS NULL OR p_user_id IS NULL THEN true
    WHEN EXISTS (
      SELECT 1
      FROM public.community_members AS m
      WHERE m.community_id = p_community_id
        AND m.user_id = p_user_id
        AND m.email_notifications_enabled IS NOT TRUE
    ) THEN false
    ELSE true
  END;
$$;

REVOKE ALL ON FUNCTION public.is_community_email_enabled (uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_community_email_enabled (uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.is_community_email_enabled (uuid, uuid) IS
  'Topluluk e-posta bildirimi açık mı? Üye tercihi false ise hayır.';

-- Bildirim satırından topluluk id'sini çöz (community_id yoksa post üzerinden).
CREATE OR REPLACE FUNCTION public.notification_community_id (
  p_community_id uuid,
  p_post_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    p_community_id,
    (
      SELECT p.community_id
      FROM public.posts AS p
      WHERE p.id = p_post_id
    )
  );
$$;

REVOKE ALL ON FUNCTION public.notification_community_id (uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notification_community_id (uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Switch kaydı: RLS/GRANT sorunlarından bağımsız SECURITY DEFINER RPC.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_community_email_notifications (
  p_community_id uuid,
  p_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid ();
  v_enabled boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_community_id IS NULL THEN
    RAISE EXCEPTION 'community_id_required';
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.community_members AS m
      WHERE m.community_id = p_community_id
        AND m.user_id = v_uid
    )
    OR EXISTS (
      SELECT 1
      FROM public.communities AS c
      WHERE c.id = p_community_id
        AND c.owner_id = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'not_community_member';
  END IF;

  INSERT INTO public.community_members AS m (
    community_id,
    user_id,
    email_notifications_enabled
  )
  VALUES (
    p_community_id,
    v_uid,
    coalesce(p_enabled, true)
  )
  ON CONFLICT (community_id, user_id)
  DO UPDATE
  SET email_notifications_enabled = EXCLUDED.email_notifications_enabled
  RETURNING m.email_notifications_enabled INTO v_enabled;

  RETURN v_enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_email_notifications (uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_community_email_notifications (uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.set_community_email_notifications (uuid, boolean) IS
  'Üye kendi topluluk e-posta tercihini kaydeder. Site içi bildirim değişmez.';

-- ---------------------------------------------------------------------------
-- Kuyruğa eklerken tercihi uygula.
-- Edge function eski kalsa / webhook kuyruğa alsa bile kapatılmış üyeye
-- yeni community maili tetikleyiciden gitmez.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_notification_email ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community_id uuid;
BEGIN
  IF NEW.email_sent IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.created_at < now() - interval '24 hours' THEN
    RETURN NEW;
  END IF;

  v_community_id := public.notification_community_id(NEW.community_id, NEW.post_id);

  IF v_community_id IS NOT NULL
     AND public.is_community_email_enabled(v_community_id, NEW.user_id) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.notification_email_queue (notification_id)
    VALUES (NEW.id)
    ON CONFLICT (notification_id) DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'notification_email_queue insert failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Bekleyen / başarısız kuyruk satırlarını da hemen durdur
UPDATE public.notification_email_queue AS q
SET
  status = 'skipped',
  processed_at = now(),
  last_error = 'community_email_opt_out'
FROM public.notifications AS n
WHERE q.notification_id = n.id
  AND q.status IN ('pending', 'failed', 'processing')
  AND public.is_community_email_enabled(
    public.notification_community_id(n.community_id, n.post_id),
    n.user_id
  ) IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
