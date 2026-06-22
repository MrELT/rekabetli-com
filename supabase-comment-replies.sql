-- Yanıtlara yorum (tek seviye): comments.parent_comment_id
-- Supabase SQL Editor'da bir kez çalıştırın.

ALTER TABLE public.comments
ADD COLUMN IF NOT EXISTS parent_comment_id uuid REFERENCES public.comments (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS comments_parent_comment_id_idx
ON public.comments (parent_comment_id)
WHERE parent_comment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS comments_post_parent_idx
ON public.comments (post_id, parent_comment_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.validate_comment_reply_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_row public.comments%ROWTYPE;
BEGIN
  IF NEW.parent_comment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO parent_row
  FROM public.comments
  WHERE id = NEW.parent_comment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'comment_parent_not_found';
  END IF;

  IF parent_row.post_id IS DISTINCT FROM NEW.post_id THEN
    RAISE EXCEPTION 'comment_parent_post_mismatch';
  END IF;

  IF parent_row.parent_comment_id IS NOT NULL THEN
    RAISE EXCEPTION 'comment_nested_reply_not_allowed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_validate_reply_row ON public.comments;

CREATE TRIGGER comments_validate_reply_row
BEFORE INSERT OR UPDATE ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.validate_comment_reply_row();

-- Bildirim: yanıta yorum → yanıt sahibine; soruya yanıt → soru sahibine
CREATE OR REPLACE FUNCTION public.notify_post_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_id uuid;
  parent_author uuid;
  post_owner uuid;
  actor_label text;
  notify_type text;
  v_community_id uuid;
BEGIN
  SELECT p.user_id, p.community_id
  INTO post_owner, v_community_id
  FROM public.posts AS p
  WHERE p.id = NEW.post_id;

  IF NEW.parent_comment_id IS NOT NULL THEN
    SELECT c.user_id
    INTO parent_author
    FROM public.comments AS c
    WHERE c.id = NEW.parent_comment_id;

    recipient_id := parent_author;
    notify_type := 'answer_reply';
  ELSE
    recipient_id := post_owner;
    notify_type := 'comment';
  END IF;

  IF recipient_id IS NULL OR recipient_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(
    nullif(
      regexp_replace(trim(p.display_name), '[<>]', '', 'g'),
      ''
    ),
    nullif(trim(NEW.author), ''),
    'Biri'
  )
  INTO actor_label
  FROM public.profiles AS p
  WHERE p.id = NEW.user_id;

  IF actor_label IS NULL THEN
    actor_label := coalesce(nullif(trim(NEW.author), ''), 'Biri');
  END IF;

  actor_label := left(actor_label, 80);

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    post_id,
    comment_id,
    community_id
  )
  VALUES (
    recipient_id,
    NEW.user_id,
    actor_label,
    notify_type,
    NEW.post_id,
    NEW.id,
    v_community_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_comment_notify ON public.comments;

CREATE TRIGGER on_comment_notify
AFTER INSERT ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.notify_post_comment();

-- notifications.type genişletmesi (mevcut constraint varsa)
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
    'community_post',
    'answer_reply',
    'mentor_package_request',
    'mentor_student_message',
    'mentor_mentor_reply'
  )
) NOT VALID;

COMMENT ON COLUMN public.comments.parent_comment_id IS
  'Dolu ise bu kayıt bir yanıta yapılmış yorumdur (tek seviye).';
