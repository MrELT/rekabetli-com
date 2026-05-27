-- Admin panel yetkilendirme + mentor atama altyapısı
-- Supabase SQL Editor'da çalıştırın.

-- 1) Admin kullanıcı listesi
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_users_select_self" ON public.admin_users;

CREATE POLICY "admin_users_select_self"
ON public.admin_users
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 2) Profilde mentor işareti
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_mentor boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS profiles_is_mentor_idx
ON public.profiles (is_mentor);

-- 3) Admin helper
CREATE OR REPLACE FUNCTION public.is_admin_user (p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users a
    WHERE a.user_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_user (uuid) TO authenticated, anon;

-- 4) Adminlerin formları görebilmesi
DROP POLICY IF EXISTS "mentor_applications_select_admin" ON public.mentor_applications;
CREATE POLICY "mentor_applications_select_admin"
ON public.mentor_applications
FOR SELECT
TO authenticated
USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "mentorship_requests_select_admin" ON public.mentorship_requests;
CREATE POLICY "mentorship_requests_select_admin"
ON public.mentorship_requests
FOR SELECT
TO authenticated
USING (public.is_admin_user(auth.uid()));

-- 5) Mentor atama işlemi (sadece admin çağırabilir)
CREATE OR REPLACE FUNCTION public.set_user_mentor_status (
  target_user_id uuid,
  mentor_status boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  UPDATE public.profiles
  SET
    is_mentor = mentor_status,
    updated_at = now()
  WHERE id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_mentor_status (uuid, boolean) TO authenticated;

-- 6) Admin: gizli topluluğa mentörü direkt ekle (onay beklemeden)
CREATE OR REPLACE FUNCTION public.admin_add_mentor_to_private_community (
  target_community_id uuid,
  mentor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_private boolean;
  mentor_exists boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT (c.visibility = 'private')
  INTO is_private
  FROM public.communities c
  WHERE c.id = target_community_id;

  IF is_private IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'private_community_required';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = mentor_user_id
      AND p.is_mentor = true
  )
  INTO mentor_exists;

  IF NOT mentor_exists THEN
    RAISE EXCEPTION 'mentor_required';
  END IF;

  INSERT INTO public.community_members (community_id, user_id)
  VALUES (target_community_id, mentor_user_id)
  ON CONFLICT (community_id, user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_add_mentor_to_private_community (uuid, uuid) TO authenticated;
