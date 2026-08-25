-- Kampanya mailleri: kuyruk (Edge timeout / Failed to fetch önlemi)
-- Gönderim anında 208 mail tek istekte bitmez; kuyruğa yazılıp arka planda işlenir.

ALTER TABLE public.campaign_mail_jobs
DROP CONSTRAINT IF EXISTS campaign_mail_jobs_status_check;

ALTER TABLE public.campaign_mail_jobs
ADD CONSTRAINT campaign_mail_jobs_status_check
CHECK (status IN ('queued', 'processing', 'completed', 'failed'));

ALTER TABLE public.campaign_mail_logs
DROP CONSTRAINT IF EXISTS campaign_mail_logs_status_check;

ALTER TABLE public.campaign_mail_logs
ADD COLUMN IF NOT EXISTS display_name text;

ALTER TABLE public.campaign_mail_logs
ADD COLUMN IF NOT EXISTS unsubscribe_token text;

ALTER TABLE public.campaign_mail_logs
ADD CONSTRAINT campaign_mail_logs_status_check
CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS campaign_mail_logs_queued_idx
ON public.campaign_mail_logs (created_at)
WHERE status = 'queued';

CREATE OR REPLACE FUNCTION public.claim_campaign_mail_queue(p_limit integer DEFAULT 20)
RETURNS SETOF public.campaign_mail_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.campaign_mail_logs AS q
    WHERE q.status = 'queued'
    ORDER BY q.created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.campaign_mail_logs AS q
  SET status = 'sending'
  FROM picked
  WHERE q.id = picked.id
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_campaign_mail_queue(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_campaign_mail_queue(integer) TO service_role;
