-- Bildirim e-posta kuyruğu (Resend rate limit / topluluk paylaşımı burst)
-- supabase-notifications-email.sql sonrasında bir kez çalıştırın.
--
-- Akış:
--   1) notifications INSERT → kuyruğa eklenir (tetikleyici)
--   2) Edge Function send-notification-email?action=process_queue (cron, dakikada 1)
--   3) Kuyruk sırayla işlenir; Resend sınırına takılmaz
--
-- Supabase Dashboard:
--   Database Webhooks (notifications INSERT) → send-notification-email artık zorunlu değil;
--   kuyruk tetikleyici ile dolar. Webhook varsa yalnızca enqueue yapar (göndermez).
--
-- Cron (Dashboard → Edge Functions → send-notification-email → Schedule):
--   */1 * * * *  —  body: {"action":"process_queue"}
--   veya aşağıdaki pg_cron bloğunu SQL Editor'da çalıştırın (pg_cron + pg_net gerekir).

CREATE TABLE IF NOT EXISTS public.notification_email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES public.notifications (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'sent', 'skipped', 'failed')
  ),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_email_queue_pending_idx
  ON public.notification_email_queue (scheduled_at, created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.notification_email_queue IS
  'Bildirim e-postaları Resend sırası; topluluk paylaşımında 30+ alıcı burst''ini güvenli işler.';

ALTER TABLE public.notification_email_queue ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Kuyruktan atomik iş al (paralel worker çakışmasını önler)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_notification_email_queue(p_limit integer DEFAULT 10)
RETURNS SETOF public.notification_email_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.notification_email_queue AS q
    WHERE q.status = 'pending'
      AND q.scheduled_at <= now()
      AND q.attempts < 8
    ORDER BY q.scheduled_at, q.created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 500))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_email_queue AS q
  SET
    status = 'processing',
    attempts = q.attempts + 1
  FROM picked
  WHERE q.id = picked.id
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_email_queue(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_notification_email_queue(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Yeni bildirim → kuyruk
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_notification_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_sent IS DISTINCT FROM true THEN
    INSERT INTO public.notification_email_queue (notification_id)
    VALUES (NEW.id)
    ON CONFLICT (notification_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_notification_enqueue_email ON public.notifications;

CREATE TRIGGER on_notification_enqueue_email
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_notification_email();

-- Henüz gönderilmemiş bildirimleri kuyruğa al
INSERT INTO public.notification_email_queue (notification_id)
SELECT n.id
FROM public.notifications AS n
WHERE n.email_sent = false
ON CONFLICT (notification_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- pg_cron (isteğe bağlı — Dashboard schedule kullanıyorsanız gerekmez)
-- PROJECT_REF ve service_role JWT ile değiştirin.
-- ---------------------------------------------------------------------------
-- SELECT cron.unschedule('notification-email-queue-worker')
-- WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-email-queue-worker');
--
-- SELECT cron.schedule(
--   'notification-email-queue-worker',
--   '* * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://PROJECT_REF.supabase.co/functions/v1/send-notification-email',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer SERVICE_ROLE_JWT'
--     ),
--     body := '{"action":"process_queue"}'::jsonb
--   ) AS request_id;
--   $$
-- );
