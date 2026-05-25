-- Topluluk içi yeni paylaşım bildirimi
-- supabase-notifications.sql ve supabase-community-posts.sql sonrasında çalıştırın.

ALTER TABLE public.notifications
ALTER COLUMN post_id DROP NOT NULL;

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS community_id uuid REFERENCES public.communities (id) ON DELETE CASCADE;

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

CREATE OR REPLACE FUNCTION public.notify_community_post ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_label text;
BEGIN
  IF NEW.community_id IS NULL THEN
    RETURN NEW;
  END IF;

  actor_label := coalesce(nullif(trim(NEW.author), ''), 'Biri');

  IF NEW.user_id IS NOT NULL THEN
    SELECT coalesce(nullif(trim(display_name), ''), actor_label)
    INTO actor_label
    FROM public.profiles
    WHERE id = NEW.user_id;
  END IF;

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    post_id,
    community_id
  )
  SELECT
    recipients.user_id,
    NEW.user_id,
    actor_label,
    'community_post',
    NEW.id,
    NEW.community_id
  FROM (
    SELECT m.user_id
    FROM public.community_members m
    WHERE m.community_id = NEW.community_id
    UNION
    SELECT c.owner_id AS user_id
    FROM public.communities c
    WHERE c.id = NEW.community_id
  ) AS recipients
  WHERE recipients.user_id IS NOT NULL
    AND (NEW.user_id IS NULL OR recipients.user_id <> NEW.user_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_community_post_notify ON public.posts;

CREATE TRIGGER on_community_post_notify
AFTER INSERT ON public.posts
FOR EACH ROW
WHEN (NEW.community_id IS NOT NULL)
EXECUTE FUNCTION public.notify_community_post ();
