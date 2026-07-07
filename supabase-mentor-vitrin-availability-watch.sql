-- Meşgul mentör vitrin bildirim kayıtları
-- supabase-mentor-vitrin-availability.sql ve supabase-mentor-meeting-postpone.sql sonrasında çalıştırın.

CREATE TABLE IF NOT EXISTS public.mentor_vitrin_availability_watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  mentor_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_vitrin_watch_no_self CHECK (user_id <> mentor_id),
  CONSTRAINT mentor_vitrin_watch_user_mentor_unique UNIQUE (user_id, mentor_id)
);

CREATE INDEX IF NOT EXISTS mentor_vitrin_watch_mentor_pending_idx
ON public.mentor_vitrin_availability_watches (mentor_id)
WHERE notified_at IS NULL;

COMMENT ON TABLE public.mentor_vitrin_availability_watches IS
  'Meşgul mentör aktif olunca bildirim almak isteyen kullanıcılar.';

ALTER TABLE public.mentor_vitrin_availability_watches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_vitrin_watch_select_own" ON public.mentor_vitrin_availability_watches;
CREATE POLICY "mentor_vitrin_watch_select_own"
ON public.mentor_vitrin_availability_watches
FOR SELECT
TO authenticated
USING (auth.uid () = user_id);

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
    'answer_reply'
  )
) NOT VALID;

CREATE OR REPLACE FUNCTION public.subscribe_mentor_vitrin_availability (p_mentor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_mentor_id IS NULL OR p_mentor_id = auth.uid () THEN
    RAISE EXCEPTION 'mentor_vitrin_watch_invalid_mentor';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'mentor_vitrin_watch_invalid_mentor';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_pages AS mp
    WHERE mp.user_id = p_mentor_id
      AND COALESCE(mp.vitrin_active, true) = false
  ) THEN
    RAISE EXCEPTION 'mentor_vitrin_watch_not_busy';
  END IF;

  INSERT INTO public.mentor_vitrin_availability_watches (
    user_id,
    mentor_id,
    notified_at
  )
  VALUES (
    auth.uid (),
    p_mentor_id,
    NULL
  )
  ON CONFLICT (user_id, mentor_id)
  DO UPDATE
  SET notified_at = NULL,
      created_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.subscribe_mentor_vitrin_availability (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscribe_mentor_vitrin_availability (uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_mentor_vitrin_availability_watchers ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mentor_label text;
  watch_row public.mentor_vitrin_availability_watches%ROWTYPE;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.vitrin_active, true) = false
     AND COALESCE(NEW.vitrin_active, true) = true THEN
    mentor_label := coalesce(public.notification_actor_label(NEW.user_id), 'Mentör');

    FOR watch_row IN
      SELECT *
      FROM public.mentor_vitrin_availability_watches AS w
      WHERE w.mentor_id = NEW.user_id
        AND w.notified_at IS NULL
    LOOP
      INSERT INTO public.notifications (
        user_id,
        actor_id,
        actor_name,
        type,
        mentor_id,
        body_text
      )
      VALUES (
        watch_row.user_id,
        NEW.user_id,
        mentor_label,
        'mentor_vitrin_active',
        NEW.user_id,
        mentor_label || ' artık yeni öğrenci kabul ediyor.'
      );

      UPDATE public.mentor_vitrin_availability_watches
      SET notified_at = now()
      WHERE id = watch_row.id;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mentor_pages_vitrin_active_notify_watchers ON public.mentor_pages;

CREATE TRIGGER mentor_pages_vitrin_active_notify_watchers
AFTER UPDATE OF vitrin_active ON public.mentor_pages
FOR EACH ROW
EXECUTE FUNCTION public.notify_mentor_vitrin_availability_watchers ();

COMMENT ON FUNCTION public.subscribe_mentor_vitrin_availability (uuid) IS
  'Meşgul mentör aktif olunca bildirim almak için kayıt oluşturur.';
COMMENT ON FUNCTION public.notify_mentor_vitrin_availability_watchers () IS
  'Mentör vitrini aktif olunca bekleyen kullanıcılara bildirim gönderir.';
