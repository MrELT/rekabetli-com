-- Kullanıcı kodu (değiştirilemez) + mentörün kod ile öğrenci eşleştirmesi
-- supabase-profile-fields.sql sonrasında bir kez çalıştırın.

-- 1) Profilde kalıcı kullanıcı kodu
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS user_code text;

CREATE OR REPLACE FUNCTION public.generate_user_code ()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := 'RKL-';
  i integer;
  pick integer;
BEGIN
  FOR i IN 1..6 LOOP
    pick := floor(random() * length(chars))::integer + 1;
    result := result || substr(chars, pick, 1);
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_user_code_on_profile ()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  candidate text;
  tries integer := 0;
BEGIN
  IF NEW.user_code IS NOT NULL AND btrim(NEW.user_code) <> '' THEN
    NEW.user_code := upper(btrim(NEW.user_code));
    RETURN NEW;
  END IF;

  LOOP
    candidate := public.generate_user_code();
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.user_code = candidate
    );
    tries := tries + 1;
    IF tries > 40 THEN
      RAISE EXCEPTION 'user_code_generation_failed';
    END IF;
  END LOOP;

  NEW.user_code := candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_assign_user_code ON public.profiles;

CREATE TRIGGER profiles_assign_user_code
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.assign_user_code_on_profile ();

CREATE OR REPLACE FUNCTION public.protect_profile_user_code ()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.user_code IS NOT NULL
    AND btrim(OLD.user_code) <> ''
    AND NEW.user_code IS DISTINCT FROM OLD.user_code THEN
    NEW.user_code := OLD.user_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_user_code ON public.profiles;

CREATE TRIGGER profiles_protect_user_code
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_user_code ();

CREATE OR REPLACE FUNCTION public.backfill_profile_user_codes ()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  candidate text;
  tries integer;
  affected integer := 0;
BEGIN
  FOR r IN
    SELECT p.id
    FROM public.profiles AS p
    WHERE p.user_code IS NULL OR btrim(p.user_code) = ''
  LOOP
    tries := 0;
    LOOP
      candidate := public.generate_user_code();
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.user_code = candidate
      );
      tries := tries + 1;
      IF tries > 40 THEN
        RAISE EXCEPTION 'user_code_generation_failed';
      END IF;
    END LOOP;

    UPDATE public.profiles
    SET user_code = candidate
    WHERE id = r.id;

    affected := affected + 1;
  END LOOP;

  RETURN affected;
END;
$$;

SELECT public.backfill_profile_user_codes();

DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*)::integer
  INTO missing
  FROM public.profiles AS p
  WHERE p.user_code IS NULL OR btrim(p.user_code) = '';

  IF missing > 0 THEN
    RAISE EXCEPTION 'user_code_backfill_incomplete: % profile(s) still missing user_code', missing;
  END IF;
END;
$$;

DROP INDEX IF EXISTS profiles_user_code_uidx;

CREATE UNIQUE INDEX profiles_user_code_uidx
ON public.profiles (user_code);

ALTER TABLE public.profiles
ALTER COLUMN user_code SET NOT NULL;

-- 2) Mentör ↔ öğrenci eşleştirmesi
CREATE TABLE IF NOT EXISTS public.mentor_linked_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_linked_students_pair_unique UNIQUE (mentor_id, student_id),
  CONSTRAINT mentor_linked_students_not_self CHECK (mentor_id <> student_id)
);

CREATE INDEX IF NOT EXISTS mentor_linked_students_mentor_idx
ON public.mentor_linked_students (mentor_id, linked_at DESC);

CREATE INDEX IF NOT EXISTS mentor_linked_students_student_idx
ON public.mentor_linked_students (student_id);

ALTER TABLE public.mentor_linked_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_linked_students_select_participant" ON public.mentor_linked_students;

CREATE POLICY "mentor_linked_students_select_participant"
ON public.mentor_linked_students
FOR SELECT
TO authenticated
USING (auth.uid () = mentor_id OR auth.uid () = student_id);

DROP POLICY IF EXISTS "mentor_linked_students_select_admin" ON public.mentor_linked_students;

CREATE POLICY "mentor_linked_students_select_admin"
ON public.mentor_linked_students
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

-- 3) Kod ile öğrenci ekleme (yalnızca mentör)
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

  INSERT INTO public.mentor_linked_students (mentor_id, student_id)
  VALUES (v_mentor_id, v_student.id)
  ON CONFLICT ON CONSTRAINT mentor_linked_students_pair_unique DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    v_already_linked := true;
  END IF;

  RETURN jsonb_build_object(
    'student_id', v_student.id,
    'display_name', coalesce(nullif(btrim(v_student.display_name), ''), 'Öğrenci'),
    'user_code', v_student.user_code,
    'already_linked', v_already_linked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_student_by_user_code (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_student_by_user_code (text) TO authenticated;

COMMENT ON COLUMN public.profiles.user_code IS
  'Kalıcı kullanıcı kodu (RKL-XXXXXX). Mentör paneline davet için paylaşılır; değiştirilemez.';

COMMENT ON TABLE public.mentor_linked_students IS
  'Mentörün kullanıcı kodu ile panele eklediği öğrenciler.';
