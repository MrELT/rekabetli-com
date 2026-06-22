-- Mentör ön talep ve mesajlaşma bildirimleri
-- supabase-mentor-messaging.sql ve mevcut notifications şeması sonrasında çalıştırın.

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS mentor_id uuid REFERENCES auth.users (id) ON DELETE CASCADE;

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS package_request_id uuid REFERENCES public.package_requests (id) ON DELETE CASCADE;

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.mentor_conversations (id) ON DELETE CASCADE;

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES public.mentor_messages (id) ON DELETE CASCADE;

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
    'answer_reply'
  )
) NOT VALID;

CREATE OR REPLACE FUNCTION public.notification_actor_label (p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT left(
    regexp_replace(
      coalesce(nullif(trim(p.display_name), ''), 'Biri'),
      '[<>]',
      '',
      'g'
    ),
    80
  )
  FROM public.profiles AS p
  WHERE p.id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.notify_mentor_package_request ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_label text;
BEGIN
  IF NEW.mentor_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = NEW.mentor_id
      AND p.is_mentor = true
  ) THEN
    RETURN NEW;
  END IF;

  actor_label := coalesce(public.notification_actor_label(NEW.user_id), 'Biri');

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    package_request_id
  )
  VALUES (
    NEW.mentor_id,
    NEW.user_id,
    actor_label,
    'mentor_package_request',
    NEW.mentor_id,
    NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_package_request_notify_mentor ON public.package_requests;

CREATE TRIGGER on_package_request_notify_mentor
AFTER INSERT ON public.package_requests
FOR EACH ROW
EXECUTE FUNCTION public.notify_mentor_package_request ();

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

  actor_label := coalesce(public.notification_actor_label(NEW.sender_id), 'Biri');

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    conversation_id,
    message_id
  )
  VALUES (
    recipient_id,
    NEW.sender_id,
    actor_label,
    notify_type,
    conv.mentor_id,
    conv.id,
    NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_mentor_message_notify ON public.mentor_messages;

CREATE TRIGGER on_mentor_message_notify
AFTER INSERT ON public.mentor_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_mentor_message ();

COMMENT ON FUNCTION public.notify_mentor_package_request () IS
  'Paket ön talebi oluşunca mentöre bildirim ekler.';
COMMENT ON FUNCTION public.notify_mentor_message () IS
  'Mentör mesajında öğrenci sorusu veya mentör yanıtı için bildirim ekler.';
