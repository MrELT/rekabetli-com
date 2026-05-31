-- Resend hızına göre kuyruk batch üst sınırını yükselt (daha önce queue SQL çalıştırdıysanız bunu da çalıştırın)

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
