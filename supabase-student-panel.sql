-- Öğrenci / danışan paneli: kayıtlı paketler, görev okuma
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
