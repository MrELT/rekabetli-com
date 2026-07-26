-- NotAl sohbet kalıcılığı
-- Bağımsız çalıştırılabilir (auth.users + RLS).

CREATE TABLE IF NOT EXISTS public.notal_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Yeni sohbet',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notal_conversations_title_len CHECK (char_length(title) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS notal_conversations_user_updated_idx
ON public.notal_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.notal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.notal_conversations (id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notal_messages_role_check CHECK (role IN ('user', 'assistant')),
  CONSTRAINT notal_messages_content_len CHECK (char_length(content) BETWEEN 1 AND 20000)
);

CREATE INDEX IF NOT EXISTS notal_messages_conversation_created_idx
ON public.notal_messages (conversation_id, created_at ASC);

ALTER TABLE public.notal_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notal_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notal_conversations_select_own" ON public.notal_conversations;
CREATE POLICY "notal_conversations_select_own"
ON public.notal_conversations
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notal_conversations_insert_own" ON public.notal_conversations;
CREATE POLICY "notal_conversations_insert_own"
ON public.notal_conversations
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notal_conversations_update_own" ON public.notal_conversations;
CREATE POLICY "notal_conversations_update_own"
ON public.notal_conversations
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notal_conversations_delete_own" ON public.notal_conversations;
CREATE POLICY "notal_conversations_delete_own"
ON public.notal_conversations
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notal_messages_select_own" ON public.notal_messages;
CREATE POLICY "notal_messages_select_own"
ON public.notal_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.notal_conversations c
    WHERE c.id = notal_messages.conversation_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "notal_messages_insert_own" ON public.notal_messages;
CREATE POLICY "notal_messages_insert_own"
ON public.notal_messages
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.notal_conversations c
    WHERE c.id = notal_messages.conversation_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "notal_messages_delete_own" ON public.notal_messages;
CREATE POLICY "notal_messages_delete_own"
ON public.notal_messages
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.notal_conversations c
    WHERE c.id = notal_messages.conversation_id
      AND c.user_id = auth.uid()
  )
);
