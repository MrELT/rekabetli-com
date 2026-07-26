-- NotAl Planner: saatlik plan blokları + Google Calendar token'ları

CREATE TABLE IF NOT EXISTS public.notal_plan_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  title text NOT NULL,
  notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'planner',
  google_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notal_plan_blocks_title_len CHECK (char_length(title) BETWEEN 1 AND 160),
  CONSTRAINT notal_plan_blocks_notes_len CHECK (char_length(notes) <= 4000),
  CONSTRAINT notal_plan_blocks_source_check CHECK (source IN ('planner', 'manual', 'google')),
  CONSTRAINT notal_plan_blocks_range_check CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS notal_plan_blocks_user_start_idx
ON public.notal_plan_blocks (user_id, start_at);

CREATE INDEX IF NOT EXISTS notal_plan_blocks_user_google_idx
ON public.notal_plan_blocks (user_id, google_event_id)
WHERE google_event_id IS NOT NULL;

ALTER TABLE public.notal_plan_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notal_plan_blocks_select_own" ON public.notal_plan_blocks;
CREATE POLICY "notal_plan_blocks_select_own"
ON public.notal_plan_blocks
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notal_plan_blocks_insert_own" ON public.notal_plan_blocks;
CREATE POLICY "notal_plan_blocks_insert_own"
ON public.notal_plan_blocks
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notal_plan_blocks_update_own" ON public.notal_plan_blocks;
CREATE POLICY "notal_plan_blocks_update_own"
ON public.notal_plan_blocks
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notal_plan_blocks_delete_own" ON public.notal_plan_blocks;
CREATE POLICY "notal_plan_blocks_delete_own"
ON public.notal_plan_blocks
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Google OAuth token'ları: istemci erişemez (RLS açık, policy yok → sadece service role)
CREATE TABLE IF NOT EXISTS public.notal_google_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text,
  expiry_date timestamptz,
  scope text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notal_google_tokens ENABLE ROW LEVEL SECURITY;
