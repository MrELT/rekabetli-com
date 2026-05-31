-- Bildirim e-posta kuyruğu worker (pg_cron)
-- Önce: supabase-notification-email-queue.sql çalıştırılmış olmalı.
-- Edge Function deploy edilmiş olmalı: send-notification-email
--
-- Aşağıdaki 3 değeri kendi projenize göre doldurun, SQL Editor'da çalıştırın:
--   YOUR_PROJECT_REF  → Dashboard → Settings → General → Reference ID
--   YOUR_CRON_SECRET  → Edge Function Secrets'ta tanımladığınız CRON_SECRET ile aynı
--
-- Cron entegrasyonu: Dashboard → Integrations → Cron → Enable (ilk kez)

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'notification-email-queue-worker';

SELECT cron.schedule(
  'notification-email-queue-worker',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := '{"action":"process_queue"}'::jsonb,
    timeout_milliseconds := 90000
  ) AS request_id;
  $$
);
