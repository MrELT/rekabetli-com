-- Öğrenci / danışan paneli: kayıtlı paketler, görev okuma, NotAl ön talebi
-- supabase-mentor-package-enrollments.sql ve supabase-mentor-package-tasks.sql sonrasında çalıştırın.

DROP POLICY IF EXISTS "mentor_package_students_select_student" ON public.mentor_package_students;

CREATE POLICY "mentor_package_students_select_student"
ON public.mentor_package_students
FOR SELECT
TO authenticated
USING (auth.uid () = student_id);

DROP POLICY IF EXISTS "mentor_package_task_packs_select_student" ON public.mentor_package_task_packs;

CREATE POLICY "mentor_package_task_packs_select_student"
ON public.mentor_package_task_packs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.mentor_package_students AS mps
    WHERE mps.student_id = auth.uid ()
      AND mps.mentor_id = mentor_package_task_packs.mentor_id
      AND mps.package_id = mentor_package_task_packs.package_id
  )
);

CREATE OR REPLACE FUNCTION public.get_student_enrolled_packages ()
RETURNS TABLE (
  enrollment_id uuid,
  mentor_id uuid,
  mentor_display_name text,
  mentor_avatar_url text,
  package_id text,
  package_title text,
  enrolled_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    mps.id AS enrollment_id,
    mps.mentor_id,
    coalesce(nullif(btrim(mp.display_name), ''), 'Mentör') AS mentor_display_name,
    mp.avatar_url AS mentor_avatar_url,
    mps.package_id,
    coalesce(
      nullif(
        (
          SELECT pkg ->> 'title'
          FROM public.mentor_pages AS pages
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(pages.packages) = 'array' THEN pages.packages
              ELSE '[]'::jsonb
            END
          ) AS pkg
          WHERE pages.user_id = mps.mentor_id
            AND pkg ->> 'id' = mps.package_id
          LIMIT 1
        ),
        ''
      ),
      'Paket'
    ) AS package_title,
    mps.created_at AS enrolled_at
  FROM public.mentor_package_students AS mps
  JOIN public.profiles AS mp ON mp.id = mps.mentor_id
  WHERE mps.student_id = auth.uid ()
  ORDER BY mps.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_student_enrolled_packages () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_enrolled_packages () TO authenticated;

CREATE TABLE IF NOT EXISTS public.notal_pre_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notal_pre_requests_note_len CHECK (char_length(note) <= 1000),
  CONSTRAINT notal_pre_requests_unique_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS notal_pre_requests_created_idx
ON public.notal_pre_requests (created_at DESC);

ALTER TABLE public.notal_pre_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notal_pre_requests_select_own" ON public.notal_pre_requests;

CREATE POLICY "notal_pre_requests_select_own"
ON public.notal_pre_requests
FOR SELECT
TO authenticated
USING (auth.uid () = user_id);

DROP POLICY IF EXISTS "notal_pre_requests_insert_own" ON public.notal_pre_requests;

CREATE POLICY "notal_pre_requests_insert_own"
ON public.notal_pre_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid () = user_id);

DROP POLICY IF EXISTS "notal_pre_requests_update_own" ON public.notal_pre_requests;

CREATE POLICY "notal_pre_requests_update_own"
ON public.notal_pre_requests
FOR UPDATE
TO authenticated
USING (auth.uid () = user_id)
WITH CHECK (auth.uid () = user_id);

DROP POLICY IF EXISTS "notal_pre_requests_select_admin" ON public.notal_pre_requests;

CREATE POLICY "notal_pre_requests_select_admin"
ON public.notal_pre_requests
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));
