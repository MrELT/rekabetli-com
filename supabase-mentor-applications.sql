-- Mentör adayı ön kayıt başvuruları
-- Supabase SQL Editor'da çalıştırın.

CREATE TABLE IF NOT EXISTS public.mentor_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  mentoring_branches text[] NOT NULL DEFAULT '{}',
  weekly_sessions integer NOT NULL CHECK (weekly_sessions >= 1 AND weekly_sessions <= 60),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mentor_applications_status_created_idx
ON public.mentor_applications (status, created_at DESC);

-- Basit metin doğrulama (script/HTML enjeksiyonunu veritabanı katmanında da sınırlar)
ALTER TABLE public.mentor_applications
DROP CONSTRAINT IF EXISTS mentor_applications_no_angle_brackets;

-- CHECK içinde alt sorgu kullanılamaz; dizi için metin gösteriminde kontrol edilir.
ALTER TABLE public.mentor_applications
ADD CONSTRAINT mentor_applications_no_angle_brackets CHECK (
  first_name !~ '[<>]'
  AND last_name !~ '[<>]'
  AND email !~ '[<>]'
  AND (phone IS NULL OR phone !~ '[<>]')
  AND mentoring_branches::text !~ '[<>]'
);

ALTER TABLE public.mentor_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_applications_select_own" ON public.mentor_applications;
DROP POLICY IF EXISTS "mentor_applications_insert_own" ON public.mentor_applications;
DROP POLICY IF EXISTS "mentor_applications_update_own_pending" ON public.mentor_applications;

CREATE POLICY "mentor_applications_select_own"
ON public.mentor_applications
FOR SELECT
TO authenticated
USING (auth.uid () = user_id);

CREATE POLICY "mentor_applications_insert_own"
ON public.mentor_applications
FOR INSERT
TO authenticated
WITH CHECK (auth.uid () = user_id);

CREATE POLICY "mentor_applications_update_own_pending"
ON public.mentor_applications
FOR UPDATE
TO authenticated
USING (auth.uid () = user_id AND status = 'pending')
WITH CHECK (auth.uid () = user_id AND status = 'pending');
