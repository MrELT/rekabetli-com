-- Mentör mesajlarında zengin metin (HTML) ve görseller
-- supabase-mentor-messaging.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.mentor_messages
DROP CONSTRAINT IF EXISTS mentor_messages_body_no_markup;

ALTER TABLE public.mentor_messages
DROP CONSTRAINT IF EXISTS mentor_messages_body_len;

ALTER TABLE public.mentor_messages
ADD CONSTRAINT mentor_messages_body_len CHECK (
  char_length(trim(body)) BETWEEN 1 AND 12000
);

CREATE OR REPLACE FUNCTION public.validate_mentor_message_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv public.mentor_conversations%ROWTYPE;
BEGIN
  SELECT *
  INTO conv
  FROM public.mentor_conversations
  WHERE id = NEW.conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mentor_message_conversation_missing';
  END IF;

  IF NEW.sender_id <> conv.student_id AND NEW.sender_id <> conv.mentor_id THEN
    RAISE EXCEPTION 'mentor_message_invalid_sender';
  END IF;

  NEW.body := left(trim(NEW.body), 12000);

  UPDATE public.mentor_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

COMMENT ON TABLE public.mentor_messages IS
  'Mentör vitrin ve paket öğrenci mesajlaşması. body düz metin veya sanitize edilmiş HTML olabilir.';
