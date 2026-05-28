-- Admin kampanya maili altyapısı
-- Supabase SQL Editor'da çalıştırın.

CREATE TABLE IF NOT EXISTS public.campaign_mail_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  subject text NOT NULL,
  preview text NOT NULL,
  button_label text NOT NULL,
  button_url text NOT NULL,
  plain_message text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'completed', 'failed')),
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaign_mail_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.campaign_mail_jobs (id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  email text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_mail_jobs_created_at_idx
ON public.campaign_mail_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS campaign_mail_logs_job_idx
ON public.campaign_mail_logs (job_id, created_at DESC);

ALTER TABLE public.campaign_mail_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_mail_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_mail_jobs_select_admin" ON public.campaign_mail_jobs;
CREATE POLICY "campaign_mail_jobs_select_admin"
ON public.campaign_mail_jobs
FOR SELECT
TO authenticated
USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "campaign_mail_logs_select_admin" ON public.campaign_mail_logs;
CREATE POLICY "campaign_mail_logs_select_admin"
ON public.campaign_mail_logs
FOR SELECT
TO authenticated
USING (public.is_admin_user(auth.uid()));
