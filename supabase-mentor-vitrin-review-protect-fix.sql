-- Mentör vitrin inceleme gönderimi: koruma trigger'ı SECURITY DEFINER
-- güncellemeyi auth.uid()=mentör olduğu için geri alıyordu → admin'de 0 görünüyordu.
-- Bu dosyayı bir kez çalıştırın (supabase db query --linked -f ...).

CREATE OR REPLACE FUNCTION public.protect_mentor_pages_review_fields ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Güvenilir RPC'ler (submit / admin) set_config ile bypass açar
  IF coalesce(current_setting('request.bypass_mentor_pages_review_protect', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL OR NOT public.is_admin_user(auth.uid()) THEN
      NEW.vitrin_review_status := 'draft';
      NEW.vitrin_terms_accepted_at := NULL;
      NEW.vitrin_submitted_at := NULL;
      NEW.vitrin_reviewed_at := NULL;
      NEW.vitrin_review_note := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF auth.uid() IS NULL OR NOT public.is_admin_user(auth.uid()) THEN
      NEW.vitrin_review_status := OLD.vitrin_review_status;
      NEW.vitrin_terms_accepted_at := OLD.vitrin_terms_accepted_at;
      NEW.vitrin_submitted_at := OLD.vitrin_submitted_at;
      NEW.vitrin_reviewed_at := OLD.vitrin_reviewed_at;
      NEW.vitrin_review_note := OLD.vitrin_review_note;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_mentor_vitrin_for_review (p_accept_terms boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.mentor_pages%ROWTYPE;
  v_label text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = v_uid
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'mentor_required';
  END IF;

  IF NOT COALESCE(p_accept_terms, false) THEN
    RAISE EXCEPTION 'vitrin_terms_required';
  END IF;

  SELECT *
  INTO v_row
  FROM public.mentor_pages AS mp
  WHERE mp.user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mentor_page_missing';
  END IF;

  IF v_row.vitrin_review_status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'vitrin_review_not_submittable';
  END IF;

  IF NOT public.mentor_vitrin_has_publishable_content(v_row) THEN
    RAISE EXCEPTION 'vitrin_content_required';
  END IF;

  PERFORM set_config('request.bypass_mentor_pages_review_protect', 'on', true);

  UPDATE public.mentor_pages AS mp
  SET
    vitrin_review_status = 'pending',
    vitrin_terms_accepted_at = now(),
    vitrin_submitted_at = now(),
    vitrin_reviewed_at = NULL,
    vitrin_review_note = NULL,
    updated_at = now()
  WHERE mp.user_id = v_uid;

  v_label := coalesce(public.notification_actor_label(v_uid), 'Mentör');

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    body_text
  )
  SELECT
    admin_row.user_id,
    v_uid,
    v_label,
    'admin_mentor_vitrin_review',
    v_uid,
    v_label || ' vitrin sayfasını incelemeniz için gönderdi.'
  FROM public.admin_users AS admin_row;

  RETURN jsonb_build_object(
    'status', 'pending',
    'submitted_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_mentor_vitrin_for_review (boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_mentor_vitrin_for_review (boolean) TO authenticated;

-- Admin onay/red da aynı bypass'ı kullanır (auth.uid null service path vs için güvenli)
CREATE OR REPLACE FUNCTION public.admin_set_mentor_vitrin_review (
  p_mentor_id uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_note text := NULLIF(left(btrim(coalesce(p_note, '')), 500), '');
  v_label text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF v_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'vitrin_review_invalid_status';
  END IF;

  IF v_status = 'rejected' AND v_note IS NULL THEN
    RAISE EXCEPTION 'vitrin_review_note_required';
  END IF;

  PERFORM set_config('request.bypass_mentor_pages_review_protect', 'on', true);

  UPDATE public.mentor_pages AS mp
  SET
    vitrin_review_status = v_status,
    vitrin_reviewed_at = now(),
    vitrin_review_note = CASE WHEN v_status = 'rejected' THEN v_note ELSE NULL END,
    updated_at = now()
  WHERE mp.user_id = p_mentor_id
    AND mp.vitrin_review_status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vitrin_review_not_pending';
  END IF;

  v_label := coalesce(public.notification_actor_label(auth.uid()), 'Admin');

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    body_text
  )
  VALUES (
    p_mentor_id,
    auth.uid(),
    v_label,
    CASE
      WHEN v_status = 'approved' THEN 'mentor_vitrin_review_approved'
      ELSE 'mentor_vitrin_review_rejected'
    END,
    p_mentor_id,
    CASE
      WHEN v_status = 'approved' THEN 'Vitrin sayfanız onaylandı ve yayına alındı.'
      ELSE 'Vitrin sayfanız reddedildi: ' || v_note
    END
  );

  RETURN jsonb_build_object(
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_mentor_vitrin_review (uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_mentor_vitrin_review (uuid, text, text) TO authenticated;

-- Hasan Feyzi'nin kaçan isteğini toparla (bildirim var, status draft kalmıştı)
SELECT set_config('request.bypass_mentor_pages_review_protect', 'on', true);

UPDATE public.mentor_pages AS mp
SET
  vitrin_review_status = 'pending',
  vitrin_terms_accepted_at = coalesce(mp.vitrin_terms_accepted_at, '2026-07-14T13:30:54.850623+00:00'::timestamptz),
  vitrin_submitted_at = coalesce(mp.vitrin_submitted_at, '2026-07-14T13:30:54.850623+00:00'::timestamptz),
  vitrin_reviewed_at = NULL,
  vitrin_review_note = NULL,
  updated_at = now()
WHERE mp.user_id = '163ae836-b954-4621-9754-a92b72983a0a'
  AND mp.vitrin_review_status = 'draft';
