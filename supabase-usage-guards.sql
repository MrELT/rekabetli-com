-- Kullanım teşhisi + korumalar
-- Supabase SQL Editor'da çalıştırın.
--
-- 1) Önce tablo boyutlarını görün (0.21 GB'ın nerede olduğunu gösterir)
-- 2) Sonra akış/bento limitlerini uygulayın
--
-- Edge Function cron'unu boş kuyrukta çalıştırmamak için
-- supabase-notification-email-cron.sql dosyasını PROJECT_REF ile yeniden çalıştırın.

-- ---------------------------------------------------------------------------
-- A) Tablo boyutları (salt okuma)
-- ---------------------------------------------------------------------------
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  c.reltuples::bigint AS estimated_rows,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
  pg_size_pretty(pg_indexes_size(c.oid)) AS index_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'storage', 'auth')
  AND c.relkind IN ('r', 'm')
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 30;

SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;

-- ---------------------------------------------------------------------------
-- B) Ana sayfa akışı: limitsiz SELECT kapanır (en fazla 50 satır)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_home_feed_posts (int);

CREATE FUNCTION public.list_home_feed_posts (p_limit int DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  author text,
  title text,
  content text,
  created_at timestamptz,
  updated_at timestamptz,
  community_id uuid,
  community_name text,
  community_visibility text,
  community_owner_id uuid,
  author_display_name text,
  author_avatar_url text,
  author_is_mentor boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.user_id,
    p.author,
    p.title,
    p.content,
    p.created_at,
    p.updated_at,
    p.community_id,
    c.name AS community_name,
    c.visibility AS community_visibility,
    c.owner_id AS community_owner_id,
    pr.display_name AS author_display_name,
    pr.avatar_url AS author_avatar_url,
    coalesce(pr.is_mentor, false) AS author_is_mentor
  FROM public.posts p
  LEFT JOIN public.communities c ON c.id = p.community_id
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  WHERE p.community_id IS NULL
    OR c.visibility = 'public'
  ORDER BY p.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.list_home_feed_posts (int) TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- C) Bento istatistikleri: ana sayfa 3 satır isteyebilir
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_communities_bento_stats ();
DROP FUNCTION IF EXISTS public.get_communities_bento_stats (int);

CREATE FUNCTION public.get_communities_bento_stats (p_limit int DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  name text,
  visibility text,
  member_count bigint,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    c.visibility,
    (
      SELECT COUNT(*)::bigint
      FROM public.community_members m
      WHERE m.community_id = c.id
    )
    + CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.community_members m
          WHERE m.community_id = c.id
            AND m.user_id = c.owner_id
        ) THEN 0::bigint
        ELSE 1::bigint
      END AS member_count,
    c.avatar_url
  FROM public.communities c
  ORDER BY member_count DESC, c.created_at DESC
  LIMIT CASE
    WHEN p_limit IS NULL THEN NULL
    ELSE GREATEST(1, LEAST(p_limit, 50))
  END;
$$;

GRANT EXECUTE ON FUNCTION public.get_communities_bento_stats (int) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- D) Eski gönderilmiş e-posta kuyruğu
-- ---------------------------------------------------------------------------
DELETE FROM public.notification_email_queue
WHERE status IN ('sent', 'skipped', 'failed')
  AND created_at < now() - interval '14 days';

-- ---------------------------------------------------------------------------
-- E) pg_net / pg_cron log şişkinliği
--    Dakikalık boş Edge çağrıları net._http_response (~104MB) ve
--    cron.job_run_details (~57MB) doldurmuş. Asıl 0.21GB burası.
-- ---------------------------------------------------------------------------
TRUNCATE net._http_response;
TRUNCATE cron.job_run_details;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'cleanup-net-cron-logs';

SELECT cron.schedule(
  'cleanup-net-cron-logs',
  '15 3 * * *',
  $cron$
  WITH cleaned AS (
    DELETE FROM net._http_response
    WHERE created < now() - interval '2 days'
    RETURNING 1
  )
  DELETE FROM cron.job_run_details
  WHERE end_time < now() - interval '7 days';
  $cron$
);

-- ---------------------------------------------------------------------------
-- F) Bildirim cron: kuyruk boşken Edge Function çağırma (Resend kuyruğu aynı)
-- ---------------------------------------------------------------------------
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

  IF rec.jobid IS NULL THEN
    RAISE NOTICE 'notification-email-queue-worker bulunamadı, cron atlandı.';
    RETURN;
  END IF;

  v_secret := (regexp_match(rec.command, 'x-cron-secret'', ''([^'']+)'))[1];
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'Mevcut cron secret okunamadı; bildirim worker güncellenmedi.';
  END IF;

  PERFORM cron.unschedule(rec.jobid);

  PERFORM cron.schedule(
    'notification-email-queue-worker',
    '* * * * *',
    format(
      $job$
      SELECT net.http_post(
        url := 'https://xtggaelcgimohftfupvo.supabase.co/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', %L
        ),
        body := '{"action":"process_queue"}'::jsonb,
        timeout_milliseconds := 90000
      ) AS request_id
      WHERE EXISTS (
        SELECT 1
        FROM public.notification_email_queue
        WHERE status = 'pending'
          AND scheduled_at <= now()
        LIMIT 1
      );
      $job$,
      v_secret
    )
  );
END
$$;

NOTIFY pgrst, 'reload schema';
