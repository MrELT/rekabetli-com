-- Mentör ↔ öğrenci mesajlaşma + mentörün ön talepleri görmesi
-- supabase-package-requests.sql ve supabase-admin-panel.sql sonrasında çalıştırın.

CREATE TABLE IF NOT EXISTS public.mentor_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_conversations_pair_unique UNIQUE (mentor_id, student_id),
  CONSTRAINT mentor_conversations_not_self CHECK (mentor_id <> student_id)
);

CREATE INDEX IF NOT EXISTS mentor_conversations_mentor_updated_idx
ON public.mentor_conversations (mentor_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS mentor_conversations_student_updated_idx
ON public.mentor_conversations (student_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.mentor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.mentor_conversations (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_messages_body_len CHECK (
    char_length(trim(body)) BETWEEN 1 AND 2000
  ),
  CONSTRAINT mentor_messages_body_no_markup CHECK (body !~ '[<>]')
);

CREATE INDEX IF NOT EXISTS mentor_messages_conversation_created_idx
ON public.mentor_messages (conversation_id, created_at ASC);

ALTER TABLE public.mentor_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_conversations_select_participant" ON public.mentor_conversations;
DROP POLICY IF EXISTS "mentor_conversations_insert_student" ON public.mentor_conversations;
DROP POLICY IF EXISTS "mentor_conversations_select_admin" ON public.mentor_conversations;

CREATE POLICY "mentor_conversations_select_participant"
ON public.mentor_conversations
FOR SELECT
TO authenticated
USING (auth.uid () = student_id OR auth.uid () = mentor_id);

CREATE POLICY "mentor_conversations_insert_student"
ON public.mentor_conversations
FOR INSERT
TO authenticated
WITH CHECK (
  student_id = auth.uid ()
  AND mentor_id <> auth.uid ()
  AND EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = mentor_id
      AND p.is_mentor = true
  )
);

CREATE POLICY "mentor_conversations_select_admin"
ON public.mentor_conversations
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

DROP POLICY IF EXISTS "mentor_messages_select_participant" ON public.mentor_messages;
DROP POLICY IF EXISTS "mentor_messages_insert_participant" ON public.mentor_messages;
DROP POLICY IF EXISTS "mentor_messages_select_admin" ON public.mentor_messages;

CREATE POLICY "mentor_messages_select_participant"
ON public.mentor_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.mentor_conversations AS c
    WHERE c.id = conversation_id
      AND (c.student_id = auth.uid () OR c.mentor_id = auth.uid ())
  )
);

CREATE POLICY "mentor_messages_insert_participant"
ON public.mentor_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = auth.uid ()
  AND EXISTS (
    SELECT 1
    FROM public.mentor_conversations AS c
    WHERE c.id = conversation_id
      AND (c.student_id = auth.uid () OR c.mentor_id = auth.uid ())
  )
);

CREATE POLICY "mentor_messages_select_admin"
ON public.mentor_messages
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

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

  NEW.body := left(trim(NEW.body), 2000);

  UPDATE public.mentor_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mentor_messages_validate_row ON public.mentor_messages;

CREATE TRIGGER mentor_messages_validate_row
BEFORE INSERT ON public.mentor_messages
FOR EACH ROW
EXECUTE FUNCTION public.validate_mentor_message_row();

-- Mentör kendi paket ön taleplerini görebilsin
DROP POLICY IF EXISTS "package_requests_select_mentor" ON public.package_requests;

CREATE POLICY "package_requests_select_mentor"
ON public.package_requests
FOR SELECT
TO authenticated
USING (auth.uid () = mentor_id);

COMMENT ON TABLE public.mentor_conversations IS
  'Mentör ve öğrenci arasındaki soru-cevap konuşmaları.';
COMMENT ON TABLE public.mentor_messages IS
  'Mentör vitrin mesajlaşma satırları.';

-- Bildirimler: supabase-mentor-notifications.sql dosyasını da çalıştırın.
