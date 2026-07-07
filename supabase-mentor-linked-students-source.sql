-- mentor_linked_students: kod ile eklenen vs paket satın alımı ile oluşan kayıtları ayır
-- supabase-user-code-mentor-students.sql sonrasında çalıştırın.

ALTER TABLE public.mentor_linked_students
ADD COLUMN IF NOT EXISTS linked_source text NOT NULL DEFAULT 'code';

ALTER TABLE public.mentor_linked_students
DROP CONSTRAINT IF EXISTS mentor_linked_students_source_check;

ALTER TABLE public.mentor_linked_students
ADD CONSTRAINT mentor_linked_students_source_check CHECK (
  linked_source IN ('code', 'purchase')
);

COMMENT ON COLUMN public.mentor_linked_students.linked_source IS
  'code: mentör panelinden kullanıcı kodu ile eklendi. purchase: paket satın alımı sırasında FK için oluşturuldu.';

-- Satın alım kaynaklı bağlantıları geriye dönük işaretle
UPDATE public.mentor_linked_students AS mls
SET linked_source = 'purchase'
WHERE mls.linked_source = 'code'
  AND EXISTS (
    SELECT 1
    FROM public.package_orders AS po
    WHERE po.mentor_id = mls.mentor_id
      AND po.user_id = mls.student_id
      AND po.status = 'paid'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.package_orders AS po2
    WHERE po2.mentor_id = mls.mentor_id
      AND po2.user_id = mls.student_id
      AND po2.status = 'paid'
      AND po2.paid_at IS NOT NULL
      AND mls.linked_at < po2.paid_at - interval '1 hour'
  );

CREATE OR REPLACE FUNCTION public.link_student_by_user_code (p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
  v_normalized text;
  v_student public.profiles%ROWTYPE;
  v_inserted uuid;
  v_already_linked boolean := false;
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

  v_normalized := upper(
    regexp_replace(btrim(coalesce(p_code, '')), '\s+', '', 'g')
  );

  IF length(v_normalized) < 6 THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  SELECT *
  INTO v_student
  FROM public.profiles AS p
  WHERE upper(p.user_code) = v_normalized
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_not_found';
  END IF;

  IF v_student.id = v_mentor_id THEN
    RAISE EXCEPTION 'cannot_link_self';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.mentor_linked_students AS mls
    WHERE mls.mentor_id = v_mentor_id
      AND mls.student_id = v_student.id
      AND mls.linked_source = 'code'
  )
  INTO v_already_linked;

  INSERT INTO public.mentor_linked_students (mentor_id, student_id, linked_source)
  VALUES (v_mentor_id, v_student.id, 'code')
  ON CONFLICT ON CONSTRAINT mentor_linked_students_pair_unique
  DO UPDATE SET linked_source = 'code'
  RETURNING id INTO v_inserted;

  RETURN jsonb_build_object(
    'student_id', v_student.id,
    'display_name', coalesce(nullif(btrim(v_student.display_name), ''), 'Öğrenci'),
    'user_code', v_student.user_code,
    'already_linked', v_already_linked
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_mentor_package_enrollment (
  p_mentor_id uuid,
  p_student_id uuid,
  p_package_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_id text := btrim(coalesce(p_package_id, ''));
  v_enrollment_id uuid;
  v_already_enrolled boolean := false;
BEGIN
  IF p_mentor_id IS NULL OR p_student_id IS NULL OR p_mentor_id = p_student_id THEN
    RAISE EXCEPTION 'package_enrollment_invalid';
  END IF;

  IF v_package_id = ''
    OR char_length(v_package_id) > 64
    OR v_package_id !~ '^[a-zA-Z0-9_-]+$' THEN
    RAISE EXCEPTION 'package_enrollment_invalid_package';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_student_id
  ) THEN
    RAISE EXCEPTION 'student_profile_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
      AND mps.student_id = p_student_id
      AND mps.package_id = v_package_id
  ) THEN
    SELECT mps.id
    INTO v_enrollment_id
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
      AND mps.student_id = p_student_id
      AND mps.package_id = v_package_id
    LIMIT 1;

    v_already_enrolled := true;
  ELSE
    INSERT INTO public.mentor_linked_students (mentor_id, student_id, linked_source)
    VALUES (p_mentor_id, p_student_id, 'purchase')
    ON CONFLICT ON CONSTRAINT mentor_linked_students_pair_unique DO NOTHING;

    INSERT INTO public.mentor_package_students (mentor_id, student_id, package_id)
    VALUES (p_mentor_id, p_student_id, v_package_id)
    ON CONFLICT ON CONSTRAINT mentor_package_students_unique DO NOTHING
    RETURNING id INTO v_enrollment_id;

    IF v_enrollment_id IS NULL THEN
      SELECT mps.id
      INTO v_enrollment_id
      FROM public.mentor_package_students AS mps
      WHERE mps.mentor_id = p_mentor_id
        AND mps.student_id = p_student_id
        AND mps.package_id = v_package_id
      LIMIT 1;

      v_already_enrolled := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'enrollment_id', v_enrollment_id,
    'already_enrolled', v_already_enrolled
  );
END;
$$;

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
    AND mls.student_id = p_student_id
    AND mls.linked_source = 'code';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_not_linked';
  END IF;
END;
$$;

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
      AND mls.linked_source = 'code'
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
    'enrollment_id', v_inserted,
    'already_enrolled', v_already_enrolled,
    'package_title', coalesce(v_title, 'Paket')
  );
END;
$$;

COMMENT ON TABLE public.mentor_linked_students IS
  'Mentör-öğrenci bağlantısı. linked_source=code olanlar panelde kod ile eklenen öğrencilerdir.';
