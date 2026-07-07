-- ACİL: Bildirim e-posta gönderimini anında durdurur.
-- Supabase SQL Editor veya: supabase db query --linked -f supabase-notification-email-emergency-stop.sql

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('notification-email-queue-worker', 'notification-email-queue');

UPDATE public.notification_email_queue
SET
  status = 'failed',
  processed_at = now(),
  last_error = 'manual_emergency_stop'
WHERE status IN ('pending', 'processing');
