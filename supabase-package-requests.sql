-- Paket ön talepleri (mentör vitrin paketleri)
-- Supabase SQL Editor'da çalıştırın.
-- Ön koşul: supabase-admin-panel.sql (is_admin_user fonksiyonu) daha önce çalıştırılmış olmalı.
-- Ardından: supabase-package-requests-security.sql (sunucu doğrulama tetikleyicisi).

CREATE TABLE IF NOT EXISTS public.package_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  mentor_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  package_id text NOT NULL,
  package_title text NOT NULL,
  package_price numeric,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'contacted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_requests_user_mentor_package_unique UNIQUE (user_id, mentor_id, package_id)
);

CREATE INDEX IF NOT EXISTS package_requests_status_created_idx
ON public.package_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS package_requests_mentor_created_idx
ON public.package_requests (mentor_id, created_at DESC);

ALTER TABLE public.package_requests
DROP CONSTRAINT IF EXISTS package_requests_no_angle_brackets;

ALTER TABLE public.package_requests
ADD CONSTRAINT package_requests_no_angle_brackets CHECK (
  package_title !~ '[<>]'
  AND first_name !~ '[<>]'
  AND last_name !~ '[<>]'
  AND email !~ '[<>]'
  AND (phone IS NULL OR phone !~ '[<>]')
  AND (note IS NULL OR note !~ '[<>]')
);

ALTER TABLE public.package_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "package_requests_select_own" ON public.package_requests;
DROP POLICY IF EXISTS "package_requests_insert_own" ON public.package_requests;
DROP POLICY IF EXISTS "package_requests_update_own_pending" ON public.package_requests;
DROP POLICY IF EXISTS "package_requests_select_admin" ON public.package_requests;

CREATE POLICY "package_requests_select_own"
ON public.package_requests
FOR SELECT
TO authenticated
USING (auth.uid () = user_id);

CREATE POLICY "package_requests_insert_own"
ON public.package_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid () = user_id);

CREATE POLICY "package_requests_update_own_pending"
ON public.package_requests
FOR UPDATE
TO authenticated
USING (auth.uid () = user_id AND status = 'pending')
WITH CHECK (auth.uid () = user_id AND status = 'pending');

CREATE POLICY "package_requests_select_admin"
ON public.package_requests
FOR SELECT
TO authenticated
USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "package_requests_select_mentor" ON public.package_requests;

CREATE POLICY "package_requests_select_mentor"
ON public.package_requests
FOR SELECT
TO authenticated
USING (auth.uid () = mentor_id);

COMMENT ON TABLE public.package_requests IS
  'Mentör vitrin paketleri için kullanıcı ön talepleri.';
