-- Öğrenci paneli bildirimleri: mentör yanıtlarına enrollment_id ekle.
-- supabase-mentor-notifications.sql ve supabase-mentor-meeting-proposals.sql sonrasında çalıştırın.

CREATE OR REPLACE FUNCTION public.notify_mentor_message ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv public.mentor_conversations%ROWTYPE;
  actor_label text;
  recipient_id uuid;
  notify_type text;
  v_enrollment_id uuid;
BEGIN
  SELECT *
  INTO conv
  FROM public.mentor_conversations
  WHERE id = NEW.conversation_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_id = conv.student_id THEN
    recipient_id := conv.mentor_id;
    notify_type := 'mentor_student_message';
  ELSIF NEW.sender_id = conv.mentor_id THEN
    recipient_id := conv.student_id;
    notify_type := 'mentor_mentor_reply';
  ELSE
    RETURN NEW;
  END IF;

  IF recipient_id IS NULL OR recipient_id = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  IF notify_type = 'mentor_mentor_reply' THEN
    SELECT mps.id
    INTO v_enrollment_id
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = conv.mentor_id
      AND mps.student_id = conv.student_id
    ORDER BY mps.created_at DESC
    LIMIT 1;
  END IF;

  actor_label := coalesce(public.notification_actor_label(NEW.sender_id), 'Biri');

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    conversation_id,
    message_id,
    enrollment_id
  )
  VALUES (
    recipient_id,
    NEW.sender_id,
    actor_label,
    notify_type,
    conv.mentor_id,
    conv.id,
    NEW.id,
    v_enrollment_id
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_mentor_message () IS
  'Mentör mesajında öğrenci sorusu veya mentör yanıtı için bildirim ekler. Öğrenci yanıtlarında enrollment_id doldurulur.';
