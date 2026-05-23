-- E-posta bildirimleri (Edge Function: send-notification-email)
-- Supabase SQL Editor'da çalıştırın.

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS email_sent boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS notifications_email_sent_rate_idx
ON public.notifications (user_id, created_at DESC)
WHERE email_sent = true;
