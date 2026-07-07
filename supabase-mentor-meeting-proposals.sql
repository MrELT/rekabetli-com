-- Mentör → öğrenci görüşme zamanı teklifleri
-- supabase-mentor-package-enrollments.sql ve supabase-mentor-notifications.sql sonrasında çalıştırın.

CREATE TABLE IF NOT EXISTS public.mentor_meeting_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  package_id text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_meeting_proposals_status_check CHECK (
    status IN (
      'pending',
      'responded',
      'confirmed',
      'postpone_pending',
      'refunded',
      'cancelled'
    )
  ),
  CONSTRAINT mentor_meeting_proposals_package_id_format CHECK (
    char_length(package_id) BETWEEN 1 AND 64
    AND package_id ~ '^[a-zA-Z0-9_-]+$'
  ),
  CONSTRAINT mentor_meeting_proposals_note_len CHECK (
    note IS NULL OR char_length(trim(note)) <= 500
  )
);

CREATE INDEX IF NOT EXISTS mentor_meeting_proposals_student_idx
ON public.mentor_meeting_proposals (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mentor_meeting_proposals_mentor_package_idx
ON public.mentor_meeting_proposals (mentor_id, package_id, student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mentor_meeting_proposal_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.mentor_meeting_proposals (id) ON DELETE CASCADE,
  option_kind text NOT NULL,
  starts_at timestamptz,
  sort_order int NOT NULL DEFAULT 0,
  CONSTRAINT mentor_meeting_proposal_options_kind_check CHECK (
    option_kind IN ('datetime', 'other')
  ),
  CONSTRAINT mentor_meeting_proposal_options_datetime_check CHECK (
    (option_kind = 'datetime' AND starts_at IS NOT NULL)
    OR (option_kind = 'other' AND starts_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS mentor_meeting_proposal_options_proposal_idx
ON public.mentor_meeting_proposal_options (proposal_id, sort_order);

CREATE TABLE IF NOT EXISTS public.mentor_meeting_proposal_responses (
  proposal_id uuid PRIMARY KEY REFERENCES public.mentor_meeting_proposals (id) ON DELETE CASCADE,
  selected_option_id uuid NOT NULL REFERENCES public.mentor_meeting_proposal_options (id) ON DELETE CASCADE,
  student_note text,
  responded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_meeting_proposal_responses_note_len CHECK (
    student_note IS NULL OR char_length(trim(student_note)) <= 500
  )
);

ALTER TABLE public.mentor_meeting_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_meeting_proposal_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_meeting_proposal_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_meeting_proposals_select_mentor" ON public.mentor_meeting_proposals;
CREATE POLICY "mentor_meeting_proposals_select_mentor"
ON public.mentor_meeting_proposals
FOR SELECT
TO authenticated
USING (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
);

DROP POLICY IF EXISTS "mentor_meeting_proposals_select_student" ON public.mentor_meeting_proposals;
CREATE POLICY "mentor_meeting_proposals_select_student"
ON public.mentor_meeting_proposals
FOR SELECT
TO authenticated
USING (
  auth.uid () = student_id
  AND EXISTS (
    SELECT 1
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = mentor_meeting_proposals.mentor_id
      AND mps.student_id = mentor_meeting_proposals.student_id
      AND mps.package_id = mentor_meeting_proposals.package_id
  )
);

DROP POLICY IF EXISTS "mentor_meeting_proposals_insert_mentor" ON public.mentor_meeting_proposals;
CREATE POLICY "mentor_meeting_proposals_insert_mentor"
ON public.mentor_meeting_proposals
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
  AND EXISTS (
    SELECT 1
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = mentor_meeting_proposals.mentor_id
      AND mps.student_id = mentor_meeting_proposals.student_id
      AND mps.package_id = mentor_meeting_proposals.package_id
  )
);

DROP POLICY IF EXISTS "mentor_meeting_proposals_update_mentor" ON public.mentor_meeting_proposals;
CREATE POLICY "mentor_meeting_proposals_update_mentor"
ON public.mentor_meeting_proposals
FOR UPDATE
TO authenticated
USING (auth.uid () = mentor_id)
WITH CHECK (auth.uid () = mentor_id);

DROP POLICY IF EXISTS "mentor_meeting_proposal_options_select" ON public.mentor_meeting_proposal_options;
CREATE POLICY "mentor_meeting_proposal_options_select"
ON public.mentor_meeting_proposal_options
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.mentor_meeting_proposals AS p
    WHERE p.id = mentor_meeting_proposal_options.proposal_id
      AND (p.mentor_id = auth.uid () OR p.student_id = auth.uid ())
  )
);

DROP POLICY IF EXISTS "mentor_meeting_proposal_options_insert_mentor" ON public.mentor_meeting_proposal_options;
CREATE POLICY "mentor_meeting_proposal_options_insert_mentor"
ON public.mentor_meeting_proposal_options
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.mentor_meeting_proposals AS p
    WHERE p.id = mentor_meeting_proposal_options.proposal_id
      AND p.mentor_id = auth.uid ()
  )
);

DROP POLICY IF EXISTS "mentor_meeting_proposal_responses_select" ON public.mentor_meeting_proposal_responses;
CREATE POLICY "mentor_meeting_proposal_responses_select"
ON public.mentor_meeting_proposal_responses
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.mentor_meeting_proposals AS p
    WHERE p.id = mentor_meeting_proposal_responses.proposal_id
      AND (p.mentor_id = auth.uid () OR p.student_id = auth.uid ())
  )
);

DROP POLICY IF EXISTS "mentor_meeting_proposal_responses_insert_student" ON public.mentor_meeting_proposal_responses;
CREATE POLICY "mentor_meeting_proposal_responses_insert_student"
ON public.mentor_meeting_proposal_responses
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.mentor_meeting_proposals AS p
    WHERE p.id = mentor_meeting_proposal_responses.proposal_id
      AND p.student_id = auth.uid ()
      AND p.status = 'pending'
  )
);

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS meeting_proposal_id uuid REFERENCES public.mentor_meeting_proposals (id) ON DELETE CASCADE;

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS enrollment_id uuid;

ALTER TABLE public.mentor_meeting_proposals
ADD COLUMN IF NOT EXISTS scheduled_starts_at timestamptz,
ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
ADD COLUMN IF NOT EXISTS reminder_1d_sent_at timestamptz,
ADD COLUMN IF NOT EXISTS reminder_30m_sent_at timestamptz;

ALTER TABLE public.mentor_meeting_proposals
DROP CONSTRAINT IF EXISTS mentor_meeting_proposals_status_check;

ALTER TABLE public.mentor_meeting_proposals
ADD CONSTRAINT mentor_meeting_proposals_status_check CHECK (
  status IN (
    'pending',
    'responded',
    'confirmed',
    'postpone_pending',
    'refunded',
    'cancelled'
  )
);

CREATE INDEX IF NOT EXISTS mentor_meeting_proposals_confirmed_reminders_idx
ON public.mentor_meeting_proposals (scheduled_starts_at)
WHERE status = 'confirmed'
  AND scheduled_starts_at IS NOT NULL;

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS body_text text;

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
    'mentor_meeting_reminder_1d',
    'mentor_meeting_reminder_30m',
    'answer_reply'
  )
) NOT VALID;

CREATE OR REPLACE FUNCTION public.format_meeting_datetime_tr (p_ts timestamptz)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT to_char(p_ts AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY') || ', ' ||
    to_char(p_ts AT TIME ZONE 'Europe/Istanbul', 'HH24:MI');
$$;

CREATE OR REPLACE FUNCTION public.send_meeting_proposal (
  p_student_id uuid,
  p_package_id text,
  p_note text DEFAULT NULL,
  p_options jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
  v_proposal_id uuid;
  v_note text;
  v_option jsonb;
  v_kind text;
  v_starts_at timestamptz;
  v_sort int := 0;
  v_actor_label text;
  v_enrollment_id uuid;
BEGIN
  IF v_mentor_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_student_id IS NULL OR p_package_id IS NULL OR jsonb_typeof(p_options) <> 'array' THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  IF jsonb_array_length(p_options) < 1 THEN
    RAISE EXCEPTION 'options_required';
  END IF;

  IF NOT public.mentor_owns_package_id(v_mentor_id, p_package_id) THEN
    RAISE EXCEPTION 'package_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = v_mentor_id
      AND mps.student_id = p_student_id
      AND mps.package_id = p_package_id
  ) THEN
    RAISE EXCEPTION 'student_not_enrolled';
  END IF;

  v_note := left(regexp_replace(coalesce(p_note, ''), '[<>]', '', 'g'), 500);
  IF v_note IS NOT NULL AND btrim(v_note) = '' THEN
    v_note := NULL;
  END IF;

  UPDATE public.mentor_meeting_proposals
  SET status = 'cancelled',
      updated_at = now()
  WHERE mentor_id = v_mentor_id
    AND student_id = p_student_id
    AND package_id = p_package_id
    AND status = 'pending';

  INSERT INTO public.mentor_meeting_proposals (
    mentor_id,
    student_id,
    package_id,
    note,
    status
  )
  VALUES (
    v_mentor_id,
    p_student_id,
    p_package_id,
    v_note,
    'pending'
  )
  RETURNING id INTO v_proposal_id;

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
      VALUES (v_proposal_id, 'datetime', v_starts_at, v_sort);
    ELSE
      INSERT INTO public.mentor_meeting_proposal_options (
        proposal_id,
        option_kind,
        sort_order
      )
      VALUES (v_proposal_id, 'other', v_sort);
    END IF;

    v_sort := v_sort + 1;
  END LOOP;

  SELECT mps.id
  INTO v_enrollment_id
  FROM public.mentor_package_students AS mps
  WHERE mps.mentor_id = v_mentor_id
    AND mps.student_id = p_student_id
    AND mps.package_id = p_package_id
  LIMIT 1;

  v_actor_label := coalesce(public.notification_actor_label(v_mentor_id), 'Mentörünüz');

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    meeting_proposal_id,
    enrollment_id
  )
  VALUES (
    p_student_id,
    v_mentor_id,
    v_actor_label,
    'mentor_meeting_proposal',
    v_mentor_id,
    v_proposal_id,
    v_enrollment_id
  );

  RETURN v_proposal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_meeting_proposal (uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_meeting_proposal (uuid, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_meeting_proposal (
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
  v_note text;
BEGIN
  IF v_student_id IS NULL OR p_proposal_id IS NULL OR p_selected_option_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_meeting_proposals AS p
    WHERE p.id = p_proposal_id
      AND p.student_id = v_student_id
      AND p.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_meeting_proposal_options AS o
    WHERE o.id = p_selected_option_id
      AND o.proposal_id = p_proposal_id
  ) THEN
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

  UPDATE public.mentor_meeting_proposals
  SET status = 'responded',
      updated_at = now()
  WHERE id = p_proposal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_meeting_proposal (uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_meeting_proposal (uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_meeting_proposal (p_proposal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
BEGIN
  IF v_mentor_id IS NULL OR p_proposal_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  UPDATE public.mentor_meeting_proposals
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = p_proposal_id
    AND mentor_id = v_mentor_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_meeting_proposal (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_meeting_proposal (uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_meeting_proposal (p_proposal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
  v_proposal public.mentor_meeting_proposals%ROWTYPE;
  v_selected public.mentor_meeting_proposal_options%ROWTYPE;
  v_actor_label text;
  v_enrollment_id uuid;
  v_body text;
  v_when text;
BEGIN
  IF v_mentor_id IS NULL OR p_proposal_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  SELECT *
  INTO v_proposal
  FROM public.mentor_meeting_proposals
  WHERE id = p_proposal_id
    AND mentor_id = v_mentor_id
    AND status = 'responded';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;

  SELECT o.*
  INTO v_selected
  FROM public.mentor_meeting_proposal_responses AS r
  JOIN public.mentor_meeting_proposal_options AS o ON o.id = r.selected_option_id
  WHERE r.proposal_id = p_proposal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'response_not_found';
  END IF;

  v_actor_label := coalesce(public.notification_actor_label(v_mentor_id), 'Mentörünüz');

  IF v_selected.option_kind = 'datetime' THEN
    IF v_selected.starts_at IS NULL OR v_selected.starts_at <= now() THEN
      RAISE EXCEPTION 'invalid_datetime';
    END IF;

    v_when := public.format_meeting_datetime_tr(v_selected.starts_at);
    v_body := format(
      '%s görüşmenizi %s tarihinde onayladı. Toplantıdan bir gün önce ve 30 dakika önce hatırlatma alacaksınız. 30 dakika öncesinde görüşme bağlantısı size iletilecektir.',
      v_actor_label,
      v_when
    );

    UPDATE public.mentor_meeting_proposals
    SET status = 'confirmed',
        scheduled_starts_at = v_selected.starts_at,
        confirmed_at = now(),
        updated_at = now()
    WHERE id = p_proposal_id;
  ELSE
    v_body := format(
      '%s görüşme talebinizi onayladı. Alternatif zaman için sizinle iletişime geçecektir.',
      v_actor_label
    );

    UPDATE public.mentor_meeting_proposals
    SET status = 'confirmed',
        scheduled_starts_at = NULL,
        confirmed_at = now(),
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
    v_proposal.student_id,
    v_mentor_id,
    v_actor_label,
    'mentor_meeting_confirmed',
    v_mentor_id,
    p_proposal_id,
    v_enrollment_id,
    v_body
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_meeting_proposal (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_meeting_proposal (uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reopen_meeting_for_new_proposal (p_proposal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
BEGIN
  IF v_mentor_id IS NULL OR p_proposal_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  UPDATE public.mentor_meeting_proposals
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = p_proposal_id
    AND mentor_id = v_mentor_id
    AND status = 'responded';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_meeting_for_new_proposal (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_meeting_for_new_proposal (uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_meeting_reminders ()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mentor_meeting_proposals%ROWTYPE;
  v_claimed public.mentor_meeting_proposals%ROWTYPE;
  v_actor_label text;
  v_enrollment_id uuid;
  v_body text;
  v_when text;
  v_link text;
  v_sent int := 0;
BEGIN
  FOR v_row IN
    SELECT *
    FROM public.mentor_meeting_proposals
    WHERE status = 'confirmed'
      AND scheduled_starts_at IS NOT NULL
      AND scheduled_starts_at > now()
    FOR UPDATE SKIP LOCKED
  LOOP
    v_actor_label := coalesce(public.notification_actor_label(v_row.mentor_id), 'Mentörünüz');
    v_when := public.format_meeting_datetime_tr(v_row.scheduled_starts_at);

    SELECT mps.id
    INTO v_enrollment_id
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = v_row.mentor_id
      AND mps.student_id = v_row.student_id
      AND mps.package_id = v_row.package_id
    LIMIT 1;

    IF v_row.reminder_1d_sent_at IS NULL
      AND now() >= v_row.scheduled_starts_at - interval '1 day' THEN
      UPDATE public.mentor_meeting_proposals AS p
      SET reminder_1d_sent_at = now(),
          updated_at = now()
      WHERE p.id = v_row.id
        AND p.reminder_1d_sent_at IS NULL
      RETURNING p.* INTO v_claimed;

      IF FOUND THEN
        v_body := format(
          'Yarın %s saatinde mentörünüz %s ile görüşmeniz var. Toplantıdan 30 dakika önce görüşme bağlantısı size iletilecektir.',
          v_when,
          v_actor_label
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
          v_claimed.student_id,
          v_claimed.mentor_id,
          v_actor_label,
          'mentor_meeting_reminder_1d',
          v_claimed.mentor_id,
          v_claimed.id,
          v_enrollment_id,
          v_body
        );

        v_sent := v_sent + 1;
      END IF;
    END IF;

    IF v_row.reminder_30m_sent_at IS NULL
      AND now() >= v_row.scheduled_starts_at - interval '30 minutes' THEN
      UPDATE public.mentor_meeting_proposals AS p
      SET reminder_30m_sent_at = now(),
          updated_at = now()
      WHERE p.id = v_row.id
        AND p.reminder_30m_sent_at IS NULL
      RETURNING p.* INTO v_claimed;

      IF FOUND THEN
        SELECT nullif(btrim(mp.meeting_link), '')
        INTO v_link
        FROM public.mentor_pages AS mp
        WHERE mp.user_id = v_claimed.mentor_id;

        IF v_link IS NOT NULL THEN
          v_body := format(
            'Görüşmeniz 30 dakika sonra (%s). Bağlantı: %s',
            v_when,
            v_link
          );
        ELSE
          v_body := format(
            'Görüşmeniz 30 dakika sonra (%s). Mentörünüz görüşme bağlantısını kısa süre içinde paylaşacaktır.',
            v_when
          );
        END IF;

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
          v_claimed.student_id,
          v_claimed.mentor_id,
          v_actor_label,
          'mentor_meeting_reminder_30m',
          v_claimed.mentor_id,
          v_claimed.id,
          v_enrollment_id,
          v_body
        );

        v_sent := v_sent + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_sent;
END;
$$;

REVOKE ALL ON FUNCTION public.process_meeting_reminders () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_meeting_reminders () TO service_role;
