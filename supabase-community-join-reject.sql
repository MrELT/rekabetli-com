-- Gizli topluluk: katılma isteğini reddet + istekçiye bildirim
-- supabase-community-join-requests.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (
  type IN (
    'comment',
    'like',
    'community_join_request',
    'community_join_rejected',
    'community_post'
  )
);

CREATE OR REPLACE FUNCTION public.reject_community_join_request (request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.community_join_requests%ROWTYPE;
  community_name text;
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

  SELECT c.name INTO community_name
  FROM public.communities c
  WHERE c.id = req.community_id;

  IF community_name IS NULL THEN
    community_name := 'Topluluk';
  END IF;

  UPDATE public.community_join_requests
  SET
    status = 'rejected',
    reviewed_at = now(),
    reviewed_by = auth.uid ()
  WHERE id = request_id;

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    community_id,
    join_request_id
  )
  VALUES (
    req.user_id,
    auth.uid (),
    community_name,
    'community_join_rejected',
    req.community_id,
    request_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_community_join_request (uuid) TO authenticated;
