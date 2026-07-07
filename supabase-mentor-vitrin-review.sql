-- Mentör vitrin sayfası admin onayı
-- supabase-mentor-vitrin-availability.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS vitrin_review_status text NOT NULL DEFAULT 'draft';

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS vitrin_terms_accepted_at timestamptz;

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS vitrin_submitted_at timestamptz;

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS vitrin_reviewed_at timestamptz;

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS vitrin_review_note text;

ALTER TABLE public.mentor_pages
DROP CONSTRAINT IF EXISTS mentor_pages_vitrin_review_status_check;

ALTER TABLE public.mentor_pages
ADD CONSTRAINT mentor_pages_vitrin_review_status_check
CHECK (vitrin_review_status IN ('draft', 'pending', 'approved', 'rejected'));

ALTER TABLE public.mentor_pages
DROP CONSTRAINT IF EXISTS mentor_pages_vitrin_review_note_len;

ALTER TABLE public.mentor_pages
ADD CONSTRAINT mentor_pages_vitrin_review_note_len
CHECK (
  vitrin_review_note IS NULL OR char_length(trim(vitrin_review_note)) <= 500
);

COMMENT ON COLUMN public.mentor_pages.vitrin_review_status IS
  'Vitrin yayın durumu: draft (taslak), pending (admin incelemesinde), approved (yayında), rejected (reddedildi).';

CREATE INDEX IF NOT EXISTS mentor_pages_vitrin_review_pending_idx
ON public.mentor_pages (vitrin_submitted_at DESC)
WHERE vitrin_review_status = 'pending';

-- Mevcut aktif mentörleri geriye dönük onaylı say
UPDATE public.mentor_pages AS mp
SET
  vitrin_review_status = 'approved',
  vitrin_terms_accepted_at = COALESCE(mp.vitrin_terms_accepted_at, mp.updated_at),
  vitrin_reviewed_at = COALESCE(mp.vitrin_reviewed_at, mp.updated_at)
WHERE mp.vitrin_review_status = 'draft'
  AND mp.payout_ready = true
  AND NULLIF(btrim(COALESCE(mp.meeting_link, '')), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mentor_vitrin_publicly_available (p_mentor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.mentor_pages AS mp
    WHERE mp.user_id = p_mentor_id
      AND mp.vitrin_review_status = 'approved'
      AND COALESCE(mp.vitrin_active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.protect_mentor_pages_review_fields ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

DROP TRIGGER IF EXISTS mentor_pages_protect_review_fields ON public.mentor_pages;

CREATE TRIGGER mentor_pages_protect_review_fields
BEFORE INSERT OR UPDATE ON public.mentor_pages
FOR EACH ROW
EXECUTE FUNCTION public.protect_mentor_pages_review_fields ();

CREATE OR REPLACE FUNCTION public.mentor_vitrin_has_publishable_content (p_row public.mentor_pages)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_branch_count integer := 0;
  v_lesson_count integer := 0;
BEGIN
  IF NULLIF(btrim(COALESCE(p_row.photo_url, '')), '') IS NOT NULL THEN
    RETURN true;
  END IF;

  IF NULLIF(btrim(COALESCE(p_row.about, '')), '') IS NOT NULL THEN
    RETURN true;
  END IF;

  SELECT COUNT(*)::integer
  INTO v_branch_count
  FROM jsonb_array_elements(COALESCE(p_row.branches, '[]'::jsonb)) AS item
  WHERE NULLIF(btrim(COALESCE(item->>'title', '')), '') IS NOT NULL;

  IF v_branch_count > 0 THEN
    RETURN true;
  END IF;

  SELECT COUNT(*)::integer
  INTO v_lesson_count
  FROM jsonb_array_elements(COALESCE(p_row.private_lessons, '[]'::jsonb)) AS item
  WHERE NULLIF(btrim(COALESCE(item->>'title', '')), '') IS NOT NULL;

  RETURN v_lesson_count > 0;
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
  IF NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_mentor_id IS NULL THEN
    RAISE EXCEPTION 'mentor_id_required';
  END IF;

  IF v_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'vitrin_review_invalid_status';
  END IF;

  IF v_status = 'rejected' AND v_note IS NULL THEN
    RAISE EXCEPTION 'vitrin_review_note_required';
  END IF;

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

  v_label := coalesce(public.notification_actor_label(p_mentor_id), 'Mentör');

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
    'Rekabetli',
    CASE
      WHEN v_status = 'approved' THEN 'mentor_vitrin_review_approved'
      ELSE 'mentor_vitrin_review_rejected'
    END,
    p_mentor_id,
    CASE
      WHEN v_status = 'approved' THEN
        'Vitrin sayfanız onaylandı. Profiliniz mentör listesinde yayınlanabilir.'
      ELSE
        'Vitrin sayfanız reddedildi: ' || v_note
    END
  );

  RETURN jsonb_build_object(
    'mentor_id', p_mentor_id,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_mentor_vitrin_review (uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_mentor_vitrin_review (uuid, text, text) TO authenticated;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (
  type IN (
    'comment',
    'like',
    'community_join_request',
    'community_join_rejected',
    'community_post',
    'mentor_package_request',
    'mentor_student_message',
    'mentor_mentor_reply',
    'mentor_meeting_proposal',
    'mentor_meeting_confirmed',
    'mentor_meeting_postpone',
    'mentor_meeting_postpone_accepted',
    'mentor_meeting_refund_requested',
    'mentor_meeting_reminder_1d',
    'mentor_meeting_reminder_30m',
    'mentor_vitrin_active',
    'answer_reply',
    'mentor_package_purchased',
    'mentor_package_sale',
    'mentor_package_refund_requested',
    'mentor_package_refunded',
    'admin_mentor_vitrin_review',
    'mentor_vitrin_review_approved',
    'mentor_vitrin_review_rejected'
  )
) NOT VALID;

-- Meşgul mentöre talep engeli: admin onayı da gerekli
CREATE OR REPLACE FUNCTION public.validate_package_request_row ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mentor_packages jsonb;
  pkg_capacity integer;
  active_count integer;
  mentor_vitrin_active boolean;
  mentor_review_status text;
BEGIN
  IF NEW.user_id = NEW.mentor_id THEN
    RAISE EXCEPTION 'package_request_self_not_allowed';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.mentor_id IS DISTINCT FROM OLD.mentor_id
       OR NEW.package_id IS DISTINCT FROM OLD.package_id THEN
      RAISE EXCEPTION 'package_request_immutable_fields';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = NEW.mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'package_request_invalid_mentor';
  END IF;

  SELECT
    COALESCE(mp.packages, '[]'::jsonb),
    COALESCE(mp.vitrin_active, true),
    mp.vitrin_review_status
  INTO mentor_packages, mentor_vitrin_active, mentor_review_status
  FROM public.mentor_pages AS mp
  WHERE mp.user_id = NEW.mentor_id;

  IF mentor_packages IS NULL THEN
    RAISE EXCEPTION 'package_request_mentor_page_missing';
  END IF;

  IF mentor_review_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'package_request_mentor_unavailable';
  END IF;

  IF mentor_vitrin_active = false THEN
    RAISE EXCEPTION 'package_request_mentor_unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(mentor_packages) AS pkg
    WHERE pkg->>'id' = NEW.package_id
  ) THEN
    RAISE EXCEPTION 'package_request_package_not_found';
  END IF;

  SELECT NULLIF(pkg->>'capacity', '')::integer
  INTO pkg_capacity
  FROM jsonb_array_elements(mentor_packages) AS pkg
  WHERE pkg->>'id' = NEW.package_id
  LIMIT 1;

  IF pkg_capacity IS NOT NULL AND pkg_capacity > 0 THEN
    SELECT COUNT(*)::integer
    INTO active_count
    FROM public.package_requests AS pr
    WHERE pr.mentor_id = NEW.mentor_id
      AND pr.package_id = NEW.package_id
      AND pr.status IN ('pending', 'reviewing', 'contacted')
      AND (TG_OP = 'INSERT' OR pr.id <> NEW.id);

    IF active_count >= pkg_capacity THEN
      RAISE EXCEPTION 'package_request_capacity_full';
    END IF;
  END IF;

  NEW.package_title := left(trim(NEW.package_title), 120);
  NEW.first_name := left(trim(NEW.first_name), 80);
  NEW.last_name := left(trim(NEW.last_name), 80);
  NEW.email := left(lower(trim(NEW.email)), 120);
  NEW.phone := NULLIF(left(trim(COALESCE(NEW.phone, '')), 20), '');
  NEW.note := NULLIF(left(trim(COALESCE(NEW.note, '')), 500), '');

  RETURN NEW;
END;
$$;

-- Paket siparişi: onaylı vitrin zorunlu (tek imza — overload fix dosyasına bakın)
-- create_package_order burada yeniden tanımlanmaz; supabase-package-orders-create-overload-fix.sql kullanın.
