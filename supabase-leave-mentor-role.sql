-- Mentör tipinden çıkış: ünvanı kaldır, vitrin (mentor_pages) sil.
-- Bir kez çalıştırın.

-- Kullanıcı kendi is_mentor'unu yalnızca false yapabilir; true yalnızca admin/RPC.
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_mentor IS DISTINCT FROM OLD.is_mentor THEN
    IF coalesce(NEW.is_mentor, false) = true
      AND coalesce(OLD.is_mentor, false) = false
      AND NOT public.is_admin_user(auth.uid()) THEN
      RAISE EXCEPTION 'profile_field_protected';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_mentor_role (p_new_user_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new_type text := NULLIF(btrim(coalesce(p_new_user_type, '')), '');
  v_had_page boolean := false;
  v_was_mentor boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF v_new_type IS NOT NULL AND lower(v_new_type) = 'mentor' THEN
    RAISE EXCEPTION 'invalid_user_type';
  END IF;

  IF v_new_type IS NOT NULL
    AND v_new_type NOT IN ('Veli', 'Ogretmen', 'Ogrenci') THEN
    RAISE EXCEPTION 'invalid_user_type';
  END IF;

  SELECT
    (p.is_mentor = true OR lower(btrim(coalesce(p.user_type, ''))) = 'mentor')
  INTO v_was_mentor
  FROM public.profiles AS p
  WHERE p.id = v_uid;

  IF NOT FOUND OR NOT coalesce(v_was_mentor, false) THEN
    RAISE EXCEPTION 'not_a_mentor';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.mentor_pages AS mp WHERE mp.user_id = v_uid
  )
  INTO v_had_page;

  DELETE FROM public.mentor_pages AS mp
  WHERE mp.user_id = v_uid;

  UPDATE public.profiles AS p
  SET
    is_mentor = false,
    user_type = v_new_type,
    updated_at = now()
  WHERE p.id = v_uid;

  RETURN jsonb_build_object(
    'left', true,
    'user_type', to_jsonb(v_new_type),
    'vitrin_deleted', v_had_page
  );
END;
$$;

REVOKE ALL ON FUNCTION public.leave_mentor_role (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_mentor_role (text) TO authenticated;

COMMENT ON FUNCTION public.leave_mentor_role (text) IS
  'Mentör tipinden çıkış: is_mentor=false, mentor_pages silinir, user_type güncellenir.';
