-- Gizli topluluk katılma istekleri, üyelikler ve admin bildirimi
-- supabase-communities.sql çalıştırıldıktan sonra Supabase SQL Editor'da çalıştırın.

-- Gizli topluluklar da listede görünsün
DROP POLICY IF EXISTS "communities_select_private" ON public.communities;

CREATE POLICY "communities_select_private"
ON public.communities
FOR SELECT
TO authenticated, anon
USING (visibility = 'private');

-- Katılma istekleri
CREATE TABLE IF NOT EXISTS public.community_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS community_join_requests_community_idx
ON public.community_join_requests (community_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS community_join_requests_user_idx
ON public.community_join_requests (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS community_join_requests_one_pending
ON public.community_join_requests (community_id, user_id)
WHERE status = 'pending';

-- Onaylanan üyeler
CREATE TABLE IF NOT EXISTS public.community_members (
  community_id uuid NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

ALTER TABLE public.community_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;

-- RLS döngüsünü kırmak için (communities ↔ community_members)
CREATE OR REPLACE FUNCTION public.is_community_member (p_community_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.community_members m
    WHERE m.community_id = p_community_id
      AND m.user_id = auth.uid ()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_community_owner (p_community_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.communities c
    WHERE c.id = p_community_id
      AND c.owner_id = auth.uid ()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_community_member (uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_community_owner (uuid) TO authenticated, anon;

DROP POLICY IF EXISTS "join_requests_select_own" ON public.community_join_requests;
DROP POLICY IF EXISTS "join_requests_select_as_owner" ON public.community_join_requests;
DROP POLICY IF EXISTS "join_requests_insert_own" ON public.community_join_requests;
DROP POLICY IF EXISTS "join_requests_update_as_owner" ON public.community_join_requests;

CREATE POLICY "join_requests_select_own"
ON public.community_join_requests
FOR SELECT
TO authenticated
USING (user_id = auth.uid ());

CREATE POLICY "join_requests_select_as_owner"
ON public.community_join_requests
FOR SELECT
TO authenticated
USING (public.is_community_owner (community_id));

CREATE POLICY "join_requests_insert_own"
ON public.community_join_requests
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid ()
  AND NOT public.is_community_owner (community_id)
  AND NOT public.is_community_member (community_id)
);

CREATE POLICY "join_requests_update_as_owner"
ON public.community_join_requests
FOR UPDATE
TO authenticated
USING (public.is_community_owner (community_id))
WITH CHECK (public.is_community_owner (community_id));

DROP POLICY IF EXISTS "community_members_select_own" ON public.community_members;
DROP POLICY IF EXISTS "community_members_select_as_owner" ON public.community_members;
DROP POLICY IF EXISTS "community_members_select_as_member" ON public.community_members;
DROP POLICY IF EXISTS "community_members_delete_as_owner" ON public.community_members;

CREATE POLICY "community_members_select_own"
ON public.community_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid ());

CREATE POLICY "community_members_select_as_owner"
ON public.community_members
FOR SELECT
TO authenticated
USING (public.is_community_owner (community_id));

CREATE POLICY "community_members_select_as_member"
ON public.community_members
FOR SELECT
TO authenticated
USING (public.is_community_member (community_id));

CREATE OR REPLACE FUNCTION public.is_community_owner_user (
  p_community_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.communities c
    WHERE c.id = p_community_id
      AND c.owner_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_community_owner_user (uuid, uuid) TO authenticated;

CREATE POLICY "community_members_delete_as_owner"
ON public.community_members
FOR DELETE
TO authenticated
USING (
  public.is_community_owner (community_id)
  AND NOT public.is_community_owner_user (community_id, user_id)
);

-- Onay: üyelik ekle, isteği güncelle (ileride admin panelinden çağrılacak)
CREATE OR REPLACE FUNCTION public.approve_community_join_request (request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.community_join_requests%ROWTYPE;
BEGIN
  SELECT * INTO req
  FROM public.community_join_requests
  WHERE id = request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'join_request_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.communities c
    WHERE c.id = req.community_id
      AND c.owner_id = auth.uid ()
  ) THEN
    RAISE EXCEPTION 'not_community_owner';
  END IF;

  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending';
  END IF;

  UPDATE public.community_join_requests
  SET
    status = 'approved',
    reviewed_at = now(),
    reviewed_by = auth.uid ()
  WHERE id = request_id;

  INSERT INTO public.community_members (community_id, user_id)
  VALUES (req.community_id, req.user_id)
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_community_join_request (uuid) TO authenticated;

-- Bildirimler: topluluk katılma isteği
ALTER TABLE public.notifications
ALTER COLUMN post_id DROP NOT NULL;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (type IN ('comment', 'like', 'community_join_request'));

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS community_id uuid REFERENCES public.communities (id) ON DELETE CASCADE;

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS join_request_id uuid REFERENCES public.community_join_requests (id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.notify_community_join_request ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  community_owner uuid;
  community_name text;
  actor_label text;
BEGIN
  SELECT c.owner_id, c.name
  INTO community_owner, community_name
  FROM public.communities c
  WHERE c.id = NEW.community_id;

  IF community_owner IS NULL OR community_owner = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(nullif(trim(display_name), ''), 'Biri')
  INTO actor_label
  FROM public.profiles
  WHERE id = NEW.user_id;

  IF actor_label IS NULL THEN
    actor_label := 'Biri';
  END IF;

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    community_id,
    join_request_id
  )
  VALUES (
    community_owner,
    NEW.user_id,
    actor_label,
    'community_join_request',
    NEW.community_id,
    NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_community_join_request_notify ON public.community_join_requests;

CREATE TRIGGER on_community_join_request_notify
AFTER INSERT ON public.community_join_requests
FOR EACH ROW
WHEN (NEW.status = 'pending')
EXECUTE FUNCTION public.notify_community_join_request ();
