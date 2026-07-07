-- Görev paketi öğrenci bazlı aktivasyon (aktifleştir / durdur)
-- supabase-mentor-package-tasks.sql sonrasında bir kez çalıştırın.

CREATE TABLE IF NOT EXISTS public.mentor_package_task_activations (
  task_pack_id uuid NOT NULL REFERENCES public.mentor_package_task_packs (id) ON DELETE CASCADE,
  mentor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  package_id text NOT NULL,
  student_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  activated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_pack_id, student_id),
  CONSTRAINT mentor_package_task_activations_package_id_format CHECK (
    char_length(package_id) BETWEEN 1 AND 64
    AND package_id ~ '^[a-zA-Z0-9_-]+$'
  )
);

CREATE INDEX IF NOT EXISTS mentor_package_task_activations_mentor_package_idx
ON public.mentor_package_task_activations (mentor_id, package_id);

CREATE INDEX IF NOT EXISTS mentor_package_task_activations_student_active_idx
ON public.mentor_package_task_activations (student_id, is_active)
WHERE is_active = true;

ALTER TABLE public.mentor_package_task_activations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_task_activations_select_mentor" ON public.mentor_package_task_activations;

CREATE POLICY "mentor_task_activations_select_mentor"
ON public.mentor_package_task_activations
FOR SELECT
TO authenticated
USING (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
);

DROP POLICY IF EXISTS "mentor_task_activations_insert_mentor" ON public.mentor_package_task_activations;

CREATE POLICY "mentor_task_activations_insert_mentor"
ON public.mentor_package_task_activations
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
);

DROP POLICY IF EXISTS "mentor_task_activations_update_mentor" ON public.mentor_package_task_activations;

CREATE POLICY "mentor_task_activations_update_mentor"
ON public.mentor_package_task_activations
FOR UPDATE
TO authenticated
USING (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
)
WITH CHECK (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
);

DROP POLICY IF EXISTS "mentor_task_activations_delete_mentor" ON public.mentor_package_task_activations;

CREATE POLICY "mentor_task_activations_delete_mentor"
ON public.mentor_package_task_activations
FOR DELETE
TO authenticated
USING (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
);

DROP POLICY IF EXISTS "mentor_task_activations_select_student" ON public.mentor_package_task_activations;

CREATE POLICY "mentor_task_activations_select_student"
ON public.mentor_package_task_activations
FOR SELECT
TO authenticated
USING (auth.uid () = student_id);

DROP POLICY IF EXISTS "mentor_task_activations_select_admin" ON public.mentor_package_task_activations;

CREATE POLICY "mentor_task_activations_select_admin"
ON public.mentor_package_task_activations
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

DROP POLICY IF EXISTS "mentor_package_task_packs_select_student" ON public.mentor_package_task_packs;

CREATE POLICY "mentor_package_task_packs_select_student"
ON public.mentor_package_task_packs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.mentor_package_task_activations AS act
    JOIN public.mentor_package_students AS mps
      ON mps.mentor_id = act.mentor_id
      AND mps.package_id = act.package_id
      AND mps.student_id = act.student_id
    WHERE act.task_pack_id = mentor_package_task_packs.id
      AND act.student_id = auth.uid ()
      AND act.is_active = true
      AND act.mentor_id = mentor_package_task_packs.mentor_id
      AND act.package_id = mentor_package_task_packs.package_id
      AND mps.student_id = auth.uid ()
  )
);

CREATE OR REPLACE FUNCTION public.touch_mentor_task_activation_updated_at ()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.is_active AND (TG_OP = 'INSERT' OR OLD.is_active IS DISTINCT FROM NEW.is_active) THEN
    NEW.activated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mentor_package_task_activations_updated_at ON public.mentor_package_task_activations;

CREATE TRIGGER mentor_package_task_activations_updated_at
BEFORE INSERT OR UPDATE ON public.mentor_package_task_activations
FOR EACH ROW
EXECUTE FUNCTION public.touch_mentor_task_activation_updated_at ();

CREATE OR REPLACE FUNCTION public.set_task_pack_active_for_student (
  p_task_pack_id uuid,
  p_student_id uuid,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.mentor_package_task_packs%ROWTYPE;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_task
  FROM public.mentor_package_task_packs
  WHERE id = p_task_pack_id
    AND mentor_id = auth.uid ();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_pack_not_found';
  END IF;

  IF NOT public.mentor_owns_package_id (v_task.mentor_id, v_task.package_id) THEN
    RAISE EXCEPTION 'package_not_owned';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = v_task.mentor_id
      AND mps.package_id = v_task.package_id
      AND mps.student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'student_not_enrolled';
  END IF;

  INSERT INTO public.mentor_package_task_activations (
    task_pack_id,
    mentor_id,
    package_id,
    student_id,
    is_active
  )
  VALUES (
    v_task.id,
    v_task.mentor_id,
    v_task.package_id,
    p_student_id,
    coalesce(p_active, false)
  )
  ON CONFLICT (task_pack_id, student_id) DO UPDATE
  SET is_active = EXCLUDED.is_active;
END;
$$;

REVOKE ALL ON FUNCTION public.set_task_pack_active_for_student (uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_task_pack_active_for_student (uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_task_pack_active_for_package_students (
  p_task_pack_id uuid,
  p_active boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.mentor_package_task_packs%ROWTYPE;
  v_count integer := 0;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_task
  FROM public.mentor_package_task_packs
  WHERE id = p_task_pack_id
    AND mentor_id = auth.uid ();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_pack_not_found';
  END IF;

  IF NOT public.mentor_owns_package_id (v_task.mentor_id, v_task.package_id) THEN
    RAISE EXCEPTION 'package_not_owned';
  END IF;

  INSERT INTO public.mentor_package_task_activations (
    task_pack_id,
    mentor_id,
    package_id,
    student_id,
    is_active
  )
  SELECT
    v_task.id,
    v_task.mentor_id,
    v_task.package_id,
    mps.student_id,
    coalesce(p_active, false)
  FROM public.mentor_package_students AS mps
  WHERE mps.mentor_id = v_task.mentor_id
    AND mps.package_id = v_task.package_id
  ON CONFLICT (task_pack_id, student_id) DO UPDATE
  SET is_active = EXCLUDED.is_active;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_task_pack_active_for_package_students (uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_task_pack_active_for_package_students (uuid, boolean) TO authenticated;
