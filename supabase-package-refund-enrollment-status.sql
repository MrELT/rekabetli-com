-- İade sonrası kayıt silmek yerine pasifleştir; panellerde "İade edildi" göster.
-- supabase-package-orders-refund-stripe-fee.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.mentor_package_students
ADD COLUMN IF NOT EXISTS unenrolled_at timestamptz;

COMMENT ON COLUMN public.mentor_package_students.unenrolled_at IS
  'İade veya manuel çıkarma sonrası paket erişiminin kapatıldığı zaman. NULL = aktif kayıt.';

DROP FUNCTION IF EXISTS public.get_student_enrolled_packages ();

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
  v_was_inactive boolean := false;
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

  SELECT mps.id
  INTO v_enrollment_id
  FROM public.mentor_package_students AS mps
  WHERE mps.mentor_id = p_mentor_id
    AND mps.student_id = p_student_id
    AND mps.package_id = v_package_id
  LIMIT 1;

  IF v_enrollment_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.mentor_package_students AS mps
      WHERE mps.id = v_enrollment_id
        AND mps.unenrolled_at IS NULL
    ) THEN
      v_already_enrolled := true;
    ELSE
      UPDATE public.mentor_package_students AS mps
      SET unenrolled_at = NULL
      WHERE mps.id = v_enrollment_id;

      v_was_inactive := true;
      v_already_enrolled := false;
    END IF;
  ELSE
    INSERT INTO public.mentor_linked_students (mentor_id, student_id)
    VALUES (p_mentor_id, p_student_id)
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

      IF EXISTS (
        SELECT 1
        FROM public.mentor_package_students AS mps
        WHERE mps.id = v_enrollment_id
          AND mps.unenrolled_at IS NOT NULL
      ) THEN
        UPDATE public.mentor_package_students AS mps
        SET unenrolled_at = NULL
        WHERE mps.id = v_enrollment_id;

        v_was_inactive := true;
        v_already_enrolled := false;
      ELSE
        v_already_enrolled := true;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'enrollment_id', v_enrollment_id,
    'already_enrolled', v_already_enrolled,
    'reactivated', v_was_inactive
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.service_unenroll_student_from_package_order (p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
BEGIN
  SELECT *
  INTO v_order
  FROM public.package_orders AS po
  WHERE po.id = p_order_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.mentor_package_students AS mps
  SET unenrolled_at = coalesce(mps.unenrolled_at, now())
  WHERE mps.mentor_id = v_order.mentor_id
    AND mps.student_id = v_order.user_id
    AND mps.package_id = v_order.package_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_student_enrolled_packages ()
RETURNS TABLE (
  enrollment_id uuid,
  mentor_id uuid,
  mentor_display_name text,
  mentor_avatar_url text,
  package_id text,
  package_title text,
  enrolled_at timestamptz,
  unenrolled_at timestamptz,
  order_status text,
  refund_requested_at timestamptz,
  refunded_at timestamptz,
  refund_amount numeric
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
    mps.created_at AS enrolled_at,
    mps.unenrolled_at,
    latest_po.status AS order_status,
    latest_po.refund_requested_at,
    latest_po.refunded_at,
    latest_po.refund_amount
  FROM public.mentor_package_students AS mps
  JOIN public.profiles AS mp ON mp.id = mps.mentor_id
  LEFT JOIN LATERAL (
    SELECT
      po.status,
      po.refund_requested_at,
      po.refunded_at,
      po.refund_amount
    FROM public.package_orders AS po
    WHERE po.user_id = mps.student_id
      AND po.mentor_id = mps.mentor_id
      AND po.package_id = mps.package_id
    ORDER BY po.created_at DESC
    LIMIT 1
  ) AS latest_po ON true
  WHERE mps.student_id = auth.uid ()
  ORDER BY mps.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_student_enrolled_packages () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_enrolled_packages () TO authenticated;

CREATE OR REPLACE FUNCTION public.get_mentor_package_students_panel (p_package_id text)
RETURNS TABLE (
  enrollment_id uuid,
  student_id uuid,
  display_name text,
  avatar_url text,
  enrolled_at timestamptz,
  unenrolled_at timestamptz,
  order_status text,
  refund_requested_at timestamptz,
  refunded_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    mps.id AS enrollment_id,
    mps.student_id,
    coalesce(nullif(btrim(p.display_name), ''), 'Öğrenci') AS display_name,
    p.avatar_url,
    mps.created_at AS enrolled_at,
    mps.unenrolled_at,
    latest_po.status AS order_status,
    latest_po.refund_requested_at,
    latest_po.refunded_at
  FROM public.mentor_package_students AS mps
  JOIN public.profiles AS p ON p.id = mps.student_id
  LEFT JOIN LATERAL (
    SELECT
      po.status,
      po.refund_requested_at,
      po.refunded_at
    FROM public.package_orders AS po
    WHERE po.user_id = mps.student_id
      AND po.mentor_id = mps.mentor_id
      AND po.package_id = mps.package_id
    ORDER BY po.created_at DESC
    LIMIT 1
  ) AS latest_po ON true
  WHERE mps.mentor_id = auth.uid ()
    AND mps.package_id = btrim(coalesce(p_package_id, ''))
  ORDER BY
    CASE WHEN mps.unenrolled_at IS NULL THEN 0 ELSE 1 END,
    mps.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_mentor_package_students_panel (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_package_students_panel (text) TO authenticated;

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
      AND mps.unenrolled_at IS NULL
  )
);
