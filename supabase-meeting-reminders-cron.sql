-- Görüşme hatırlatmaları (1 gün ve 30 dk önce)
-- supabase-mentor-meeting-proposals.sql sonrasında çalıştırın.
-- pg_cron etkin değilse Supabase Dashboard → Database → Extensions → pg_cron

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'meeting-reminders-worker';

SELECT cron.schedule(
  'meeting-reminders-worker',
  '*/5 * * * *',
  $$SELECT public.process_meeting_reminders();$$
);
