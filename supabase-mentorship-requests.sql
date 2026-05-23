-- Öğrenci / veli mentörlük ön talep başvuruları
-- Supabase SQL Editor'da çalıştırın.

CREATE TABLE IF NOT EXISTS public.mentorship_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  requested_branches text[] NOT NULL DEFAULT '{}',
  monthly_sessions integer NOT NULL CHECK (monthly_sessions >= 1 AND monthly_sessions <= 60),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'matched', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mentorship_requests_status_created_idx
ON public.mentorship_requests (status, created_at DESC);

ALTER TABLE public.mentorship_requests
DROP CONSTRAINT IF EXISTS mentorship_requests_no_angle_brackets;

-- CHECK içinde alt sorgu kullanılamaz; dizi için metin gösteriminde kontrol edilir.
ALTER TABLE public.mentorship_requests
ADD CONSTRAINT mentorship_requests_no_angle_brackets CHECK (
  first_name !~ '[<>]'
  AND last_name !~ '[<>]'
  AND email !~ '[<>]'
  AND (phone IS NULL OR phone !~ '[<>]')
  AND requested_branches::text !~ '[<>]'
);

ALTER TABLE public.mentorship_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentorship_requests_select_own" ON public.mentorship_requests;
DROP POLICY IF EXISTS "mentorship_requests_insert_own" ON public.mentorship_requests;
DROP POLICY IF EXISTS "mentorship_requests_update_own_pending" ON public.mentorship_requests;

CREATE POLICY "mentorship_requests_select_own"
ON public.mentorship_requests
FOR SELECT
TO authenticated
USING (auth.uid () = user_id);

CREATE POLICY "mentorship_requests_insert_own"
ON public.mentorship_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid () = user_id);

CREATE POLICY "mentorship_requests_update_own_pending"
ON public.mentorship_requests
FOR UPDATE
TO authenticated
USING (auth.uid () = user_id AND status = 'pending')
WITH CHECK (auth.uid () = user_id AND status = 'pending');
