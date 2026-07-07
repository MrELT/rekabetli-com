-- Görüşme erteleme ve iade talebi
-- supabase-mentor-meeting-proposals.sql sonrasında çalıştırın.

ALTER TABLE public.mentor_meeting_proposals
ADD COLUMN IF NOT EXISTS postponed_from_at timestamptz,
ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz;

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS reliability_score smallint NOT NULL DEFAULT 100;

ALTER TABLE public.mentor_pages
DROP CONSTRAINT IF EXISTS mentor_pages_reliability_score_check;

ALTER TABLE public.mentor_pages
ADD CONSTRAINT mentor_pages_reliability_score_check CHECK (
  reliability_score BETWEEN 0 AND 100
);

COMMENT ON COLUMN public.mentor_pages.reliability_score IS
  'Mentör güvenilirlik puanı (100 üzerinden). Erteleme sonrası iade talebinde düşer.';

ALTER TABLE public.mentor_meeting_proposals
DROP CONSTRAINT IF EXISTS mentor_meeting_proposals_status_check;

ALTER TABLE public.mentor_meeting_proposals
ADD CONSTRAINT mentor_meeting_proposals_status_check CHECK (
  status IN ('pending', 'responded', 'confirmed', 'postpone_pending', 'refunded', 'cancelled')
);

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
    'answer_reply'
  )
) NOT VALID;

CREATE OR REPLACE FUNCTION public.apply_mentor_reliability_penalty (
  p_mentor_id uuid,
  p_points int DEFAULT 10
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_mentor_id IS NULL OR p_points IS NULL OR p_points < 1 THEN
    RETURN;
  END IF;

  UPDATE public.mentor_pages
  SET reliability_score = GREATEST(0, reliability_score - p_points),
      updated_at = now()
  WHERE user_id = p_mentor_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_mentor_reliability_penalty (uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_mentor_reliability_penalty (uuid, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_meeting_postpone (
  p_proposal_id uuid,
  p_note text DEFAULT NULL,
  p_options jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
  v_proposal public.mentor_meeting_proposals%ROWTYPE;
  v_note text;
  v_option jsonb;
  v_kind text;
  v_starts_at timestamptz;
  v_sort int := 0;
  v_actor_label text;
  v_enrollment_id uuid;
  v_when_old text;
  v_body text;
BEGIN
  IF v_mentor_id IS NULL OR p_proposal_id IS NULL OR jsonb_typeof(p_options) <> 'array' THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  IF jsonb_array_length(p_options) < 1 THEN
    RAISE EXCEPTION 'options_required';
  END IF;

  SELECT *
  INTO v_proposal
  FROM public.mentor_meeting_proposals
  WHERE id = p_proposal_id
    AND mentor_id = v_mentor_id
    AND status = 'confirmed'
    AND scheduled_starts_at IS NOT NULL
    AND scheduled_starts_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;

  v_note := left(regexp_replace(coalesce(p_note, ''), '[<>]', '', 'g'), 500);
  IF v_note IS NOT NULL AND btrim(v_note) = '' THEN
    v_note := NULL;
  END IF;

  DELETE FROM public.mentor_meeting_proposal_responses
  WHERE proposal_id = p_proposal_id;

  DELETE FROM public.mentor_meeting_proposal_options
  WHERE proposal_id = p_proposal_id;

  FOR v_option IN SELECT value FROM jsonb_array_elements(p_options)
  LOOP
    v_kind := coalesce(nullif(btrim(v_option ->> 'kind'), ''), nullif(btrim(v_option ->> 'option_kind'), ''));
    IF v_kind NOT IN ('datetime', 'other') THEN
      RAISE EXCEPTION 'invalid_option_kind';
    END IF;

    IF v_kind = 'datetime' THEN
      v_starts_at := coalesce(
        nullif(btrim(v_option ->> 'starts_at'), ''),
        nullif(btrim(v_option ->> 'startsAt'), '')
      )::timestamptz;
      IF v_starts_at IS NULL OR v_starts_at <= now() THEN
        RAISE EXCEPTION 'invalid_datetime';
      END IF;
      INSERT INTO public.mentor_meeting_proposal_options (
        proposal_id,
        option_kind,
        starts_at,
        sort_order
      )
      VALUES (p_proposal_id, 'datetime', v_starts_at, v_sort);
    ELSE
      INSERT INTO public.mentor_meeting_proposal_options (
        proposal_id,
        option_kind,
        sort_order
      )
      VALUES (p_proposal_id, 'other', v_sort);
    END IF;

    v_sort := v_sort + 1;
  END LOOP;

  UPDATE public.mentor_meeting_proposals
  SET status = 'postpone_pending',
      postponed_from_at = v_proposal.scheduled_starts_at,
      note = coalesce(v_note, note),
      reminder_1d_sent_at = NULL,
      reminder_30m_sent_at = NULL,
      updated_at = now()
  WHERE id = p_proposal_id;

  SELECT mps.id
  INTO v_enrollment_id
  FROM public.mentor_package_students AS mps
  WHERE mps.mentor_id = v_proposal.mentor_id
    AND mps.student_id = v_proposal.student_id
    AND mps.package_id = v_proposal.package_id
  LIMIT 1;

  v_actor_label := coalesce(public.notification_actor_label(v_mentor_id), 'Mentörünüz');
  v_when_old := public.format_meeting_datetime_tr(v_proposal.scheduled_starts_at);
  v_body := format(
    '%s %s tarihindeki görüşmeyi ertelemek istiyor. Yeni zaman seçeneklerinden birini seçebilir veya iade talep edebilirsiniz. Erteleme sonrası iade hakkınız saklıdır; iade talebi mentör profil güvenilirlik puanını düşürebilir.',
    v_actor_label,
    v_when_old
  );

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    meeting_proposal_id,
    enrollment_id,
    body_text
  )
  VALUES (
    v_proposal.student_id,
    v_mentor_id,
    v_actor_label,
    'mentor_meeting_postpone',
    v_mentor_id,
    p_proposal_id,
    v_enrollment_id,
    v_body
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_meeting_postpone (uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_meeting_postpone (uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_meeting_postpone (
  p_proposal_id uuid,
  p_selected_option_id uuid,
  p_student_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_proposal public.mentor_meeting_proposals%ROWTYPE;
  v_selected public.mentor_meeting_proposal_options%ROWTYPE;
  v_note text;
  v_actor_label text;
  v_enrollment_id uuid;
  v_body text;
  v_when text;
BEGIN
  IF v_student_id IS NULL OR p_proposal_id IS NULL OR p_selected_option_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  SELECT *
  INTO v_proposal
  FROM public.mentor_meeting_proposals
  WHERE id = p_proposal_id
    AND student_id = v_student_id
    AND status = 'postpone_pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;

  SELECT o.*
  INTO v_selected
  FROM public.mentor_meeting_proposal_options AS o
  WHERE o.id = p_selected_option_id
    AND o.proposal_id = p_proposal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_option';
  END IF;

  v_note := left(regexp_replace(coalesce(p_student_note, ''), '[<>]', '', 'g'), 500);
  IF v_note IS NOT NULL AND btrim(v_note) = '' THEN
    v_note := NULL;
  END IF;

  INSERT INTO public.mentor_meeting_proposal_responses (
    proposal_id,
    selected_option_id,
    student_note
  )
  VALUES (p_proposal_id, p_selected_option_id, v_note);

  v_actor_label := coalesce(public.notification_actor_label(v_student_id), 'Öğrenciniz');

  IF v_selected.option_kind = 'datetime' THEN
    IF v_selected.starts_at IS NULL OR v_selected.starts_at <= now() THEN
      RAISE EXCEPTION 'invalid_datetime';
    END IF;

    v_when := public.format_meeting_datetime_tr(v_selected.starts_at);
    v_body := format(
      '%s erteleme talebiniz için %s tarihini seçti. Görüşme bu saatte onaylandı.',
      v_actor_label,
      v_when
    );

    UPDATE public.mentor_meeting_proposals
    SET status = 'confirmed',
        scheduled_starts_at = v_selected.starts_at,
        confirmed_at = now(),
        reminder_1d_sent_at = NULL,
        reminder_30m_sent_at = NULL,
        updated_at = now()
    WHERE id = p_proposal_id;
  ELSE
    v_body := format(
      '%s erteleme için alternatif zaman (Diğer) seçeneğini işaretledi. Sizinle iletişime geçecektir.',
      v_actor_label
    );

    UPDATE public.mentor_meeting_proposals
    SET status = 'confirmed',
        scheduled_starts_at = NULL,
        confirmed_at = now(),
        reminder_1d_sent_at = NULL,
        reminder_30m_sent_at = NULL,
        updated_at = now()
    WHERE id = p_proposal_id;
  END IF;

  SELECT mps.id
  INTO v_enrollment_id
  FROM public.mentor_package_students AS mps
  WHERE mps.mentor_id = v_proposal.mentor_id
    AND mps.student_id = v_proposal.student_id
    AND mps.package_id = v_proposal.package_id
  LIMIT 1;

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    meeting_proposal_id,
    enrollment_id,
    body_text
  )
  VALUES (
    v_proposal.mentor_id,
    v_student_id,
    v_actor_label,
    'mentor_meeting_postpone_accepted',
    v_proposal.mentor_id,
    p_proposal_id,
    v_enrollment_id,
    v_body
  );
END;
$$;

REVOKE ALL ON FUNCTION public.respond_meeting_postpone (uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_meeting_postpone (uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_meeting_refund (
  p_proposal_id uuid,
  p_student_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_proposal public.mentor_meeting_proposals%ROWTYPE;
  v_note text;
  v_actor_label text;
  v_enrollment_id uuid;
  v_when_old text;
  v_body_student text;
  v_body_mentor text;
BEGIN
  IF v_student_id IS NULL OR p_proposal_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  SELECT *
  INTO v_proposal
  FROM public.mentor_meeting_proposals
  WHERE id = p_proposal_id
    AND student_id = v_student_id
    AND status = 'postpone_pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;

  v_note := left(regexp_replace(coalesce(p_student_note, ''), '[<>]', '', 'g'), 500);
  IF v_note IS NOT NULL AND btrim(v_note) = '' THEN
    v_note := NULL;
  END IF;

  UPDATE public.mentor_meeting_proposals
  SET status = 'refunded',
      refund_requested_at = now(),
      updated_at = now()
  WHERE id = p_proposal_id;

  PERFORM public.apply_mentor_reliability_penalty(v_proposal.mentor_id, 10);

  SELECT mps.id
  INTO v_enrollment_id
  FROM public.mentor_package_students AS mps
  WHERE mps.mentor_id = v_proposal.mentor_id
    AND mps.student_id = v_proposal.student_id
    AND mps.package_id = v_proposal.package_id
  LIMIT 1;

  v_actor_label := coalesce(public.notification_actor_label(v_student_id), 'Öğrenciniz');
  v_when_old := coalesce(
    public.format_meeting_datetime_tr(v_proposal.postponed_from_at),
    public.format_meeting_datetime_tr(v_proposal.scheduled_starts_at),
    'planlanan görüşme'
  );

  v_body_student := format(
    'Erteleme talebi sonrası iade isteğiniz alındı (%s). Ekibimiz süreci İptal ve İade Politikası kapsamında değerlendirecektir.',
    v_when_old
  );

  v_body_mentor := format(
    '%s, %s için ertelediğiniz görüşme yerine iade talep etti. Profil güvenilirlik puanınız düşürüldü.',
    v_actor_label,
    v_when_old
  );

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    meeting_proposal_id,
    enrollment_id,
    body_text
  )
  VALUES
    (
      v_student_id,
      v_proposal.mentor_id,
      coalesce(public.notification_actor_label(v_proposal.mentor_id), 'Mentörünüz'),
      'mentor_meeting_refund_requested',
      v_proposal.mentor_id,
      p_proposal_id,
      v_enrollment_id,
      v_body_student
    ),
    (
      v_proposal.mentor_id,
      v_student_id,
      v_actor_label,
      'mentor_meeting_refund_requested',
      v_proposal.mentor_id,
      p_proposal_id,
      v_enrollment_id,
      v_body_mentor
    );
END;
$$;

REVOKE ALL ON FUNCTION public.request_meeting_refund (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_meeting_refund (uuid, text) TO authenticated;
