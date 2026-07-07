-- Mentörün kod ile eklediği öğrencileri paketlere atama
-- supabase-user-code-mentor-students.sql sonrasında bir kez çalıştırın.

CREATE TABLE IF NOT EXISTS public.mentor_package_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  package_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_package_students_unique UNIQUE (mentor_id, student_id, package_id),
  CONSTRAINT mentor_package_students_package_id_format CHECK (
    char_length(package_id) BETWEEN 1 AND 64
    AND package_id ~ '^[a-zA-Z0-9_-]+$'
  ),
  CONSTRAINT mentor_package_students_link_fkey
  FOREIGN KEY (mentor_id, student_id)
  REFERENCES public.mentor_linked_students (mentor_id, student_id)
  ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS mentor_package_students_mentor_package_idx
ON public.mentor_package_students (mentor_id, package_id);

CREATE INDEX IF NOT EXISTS mentor_package_students_student_idx
ON public.mentor_package_students (student_id);

ALTER TABLE public.mentor_package_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_package_students_select_mentor" ON public.mentor_package_students;

CREATE POLICY "mentor_package_students_select_mentor"
ON public.mentor_package_students
FOR SELECT
TO authenticated
USING (auth.uid () = mentor_id);

DROP POLICY IF EXISTS "mentor_package_students_select_admin" ON public.mentor_package_students;

CREATE POLICY "mentor_package_students_select_admin"
ON public.mentor_package_students
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

CREATE OR REPLACE FUNCTION public.mentor_owns_package_id (
  p_mentor_id uuid,
  p_package_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.mentor_pages AS mp
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(mp.packages) = 'array' THEN mp.packages
        ELSE '[]'::jsonb
      END
    ) AS pkg
    WHERE mp.user_id = p_mentor_id
      AND pkg ->> 'id' = p_package_id
      AND btrim(coalesce(pkg ->> 'title', '')) <> ''
  );
$$;

REVOKE ALL ON FUNCTION public.mentor_owns_package_id (uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.unlink_mentor_student (p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
BEGIN
  IF v_mentor_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = v_mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'mentor_required';
  END IF;

  DELETE FROM public.mentor_linked_students AS mls
  WHERE mls.mentor_id = v_mentor_id
    AND mls.student_id = p_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_not_linked';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.unlink_mentor_student (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unlink_mentor_student (uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enroll_linked_student_in_package (
  p_student_id uuid,
  p_package_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
  v_package_id text;
  v_inserted uuid;
  v_already_enrolled boolean := false;
  v_title text;
BEGIN
  IF v_mentor_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = v_mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'mentor_required';
  END IF;

  v_package_id := btrim(coalesce(p_package_id, ''));

  IF v_package_id = ''
    OR char_length(v_package_id) > 64
    OR v_package_id !~ '^[a-zA-Z0-9_-]+$' THEN
    RAISE EXCEPTION 'invalid_package';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_linked_students AS mls
    WHERE mls.mentor_id = v_mentor_id
      AND mls.student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'student_not_linked';
  END IF;

  IF NOT public.mentor_owns_package_id(v_mentor_id, v_package_id) THEN
    RAISE EXCEPTION 'package_not_found';
  END IF;

  INSERT INTO public.mentor_package_students (mentor_id, student_id, package_id)
  VALUES (v_mentor_id, p_student_id, v_package_id)
  ON CONFLICT ON CONSTRAINT mentor_package_students_unique DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    v_already_enrolled := true;
  END IF;

  SELECT btrim(coalesce(pkg ->> 'title', 'Paket'))
  INTO v_title
  FROM public.mentor_pages AS mp
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(mp.packages) = 'array' THEN mp.packages
      ELSE '[]'::jsonb
    END
  ) AS pkg
  WHERE mp.user_id = v_mentor_id
    AND pkg ->> 'id' = v_package_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'package_id', v_package_id,
    'package_title', coalesce(nullif(v_title, ''), 'Paket'),
    'already_enrolled', v_already_enrolled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enroll_linked_student_in_package (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enroll_linked_student_in_package (uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unenroll_linked_student_from_package (
  p_student_id uuid,
  p_package_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
  v_package_id text;
BEGIN
  IF v_mentor_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = v_mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'mentor_required';
  END IF;

  v_package_id := btrim(coalesce(p_package_id, ''));

  IF v_package_id = ''
    OR char_length(v_package_id) > 64
    OR v_package_id !~ '^[a-zA-Z0-9_-]+$' THEN
    RAISE EXCEPTION 'invalid_package';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_linked_students AS mls
    WHERE mls.mentor_id = v_mentor_id
      AND mls.student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'student_not_linked';
  END IF;

  IF NOT public.mentor_owns_package_id(v_mentor_id, v_package_id) THEN
    RAISE EXCEPTION 'package_not_found';
  END IF;

  DELETE FROM public.mentor_package_students AS mps
  WHERE mps.mentor_id = v_mentor_id
    AND mps.student_id = p_student_id
    AND mps.package_id = v_package_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_enrolled';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.unenroll_linked_student_from_package (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unenroll_linked_student_from_package (uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_mentor_package_fill_counts (p_mentor_id uuid)
RETURNS TABLE (package_id text, fill_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    combined.package_id,
    SUM(combined.cnt)::integer AS fill_count
  FROM (
    SELECT
      pr.package_id,
      COUNT(*)::integer AS cnt
    FROM public.package_requests AS pr
    WHERE pr.mentor_id = p_mentor_id
      AND pr.status IN ('pending', 'reviewing', 'contacted')
    GROUP BY pr.package_id

    UNION ALL

    SELECT
      mps.package_id,
      COUNT(*)::integer AS cnt
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
    GROUP BY mps.package_id
  ) AS combined
  GROUP BY combined.package_id;
$$;

REVOKE ALL ON FUNCTION public.get_mentor_package_fill_counts (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_package_fill_counts (uuid) TO anon, authenticated;

COMMENT ON TABLE public.mentor_package_students IS
  'Mentörün kod ile eklediği öğrencilerin paket atamaları.';
