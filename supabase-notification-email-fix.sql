-- Bildirim e-posta kuyruğu düzeltmeleri (worker lock + takılı kayıtlar + güvenli tetikleyici)
-- Supabase SQL Editor'da bir kez çalıştırın.

-- 1) Takılı "processing" kayıtlarını geri al (5 dk+)
CREATE OR REPLACE FUNCTION public.reset_stale_notification_email_queue()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.notification_email_queue
  SET
    status = 'pending',
    last_error = coalesce(last_error, '') || ' [stale reset]'
  WHERE status = 'processing'
    AND created_at < now() - interval '5 minutes';

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_stale_notification_email_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_stale_notification_email_queue() TO service_role;

-- 2) Tek seferde bir worker (paralel webhook/cron çakışmasını önler)
CREATE OR REPLACE FUNCTION public.try_notification_email_worker_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_lock(90824001);
$$;

CREATE OR REPLACE FUNCTION public.release_notification_email_worker_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(90824001);
$$;

REVOKE ALL ON FUNCTION public.try_notification_email_worker_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_notification_email_worker_lock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_notification_email_worker_lock() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_notification_email_worker_lock() TO service_role;

-- 3) Bildirim INSERT'i asla kuyruk hatası yüzünden başarısız olmasın
CREATE OR REPLACE FUNCTION public.enqueue_notification_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_sent IS DISTINCT FROM true THEN
    BEGIN
      INSERT INTO public.notification_email_queue (notification_id)
      VALUES (NEW.id)
      ON CONFLICT (notification_id) DO NOTHING;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'notification_email_queue insert failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- 4) Kuyrukta takılı kalanları şimdi pending yap
UPDATE public.notification_email_queue
SET status = 'pending'
WHERE status = 'processing';

-- 5) Gönderilmemiş bildirimleri kuyruğa al (e-posta kaçmış olabilir)
INSERT INTO public.notification_email_queue (notification_id)
SELECT n.id
FROM public.notifications AS n
WHERE n.email_sent = false
ON CONFLICT (notification_id) DO NOTHING;
