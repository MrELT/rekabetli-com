DO $$
DECLARE
  rec record;
  v_secret text;
BEGIN
  SELECT jobid, command
  INTO rec
  FROM cron.job
  WHERE jobname = 'notification-email-queue-worker'
  LIMIT 1;

  IF rec.command IS NULL THEN
    RAISE NOTICE 'notification cron yok, kampanya cron atlandı';
    RETURN;
  END IF;

  v_secret := (regexp_match(rec.command, 'x-cron-secret'', ''([^'']+)'))[1];
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'cron secret okunamadı';
  END IF;

  BEGIN
    PERFORM cron.unschedule('campaign-email-queue-worker');
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  PERFORM cron.schedule(
    'campaign-email-queue-worker',
    '* * * * *',
    format(
      $job$
      SELECT net.http_post(
        url := 'https://xtggaelcgimohftfupvo.supabase.co/functions/v1/send-campaign-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', %L
        ),
        body := '{"action":"process_queue"}'::jsonb,
        timeout_milliseconds := 90000
      ) AS request_id
      WHERE EXISTS (
        SELECT 1
        FROM public.campaign_mail_logs
        WHERE status = 'queued'
        LIMIT 1
      );
      $job$,
      v_secret
    )
  );
END
$$;
