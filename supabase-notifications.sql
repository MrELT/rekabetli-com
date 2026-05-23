-- Bildirimler, yorumlarda user_id ve otomatik bildirim tetikleyicileri
-- Supabase SQL Editor'da çalıştırın (profiles ve posts tabloları hazır olmalı).

-- Yorumlara gönderen kullanıcı
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id);

-- Bildirimler tablosu
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  actor_name text NOT NULL DEFAULT 'Biri',
  type text NOT NULL CHECK (type IN ('comment', 'like')),
  post_id uuid NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
  comment_id uuid REFERENCES public.comments (id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
ON public.notifications (user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;

CREATE POLICY "notifications_select_own"
ON public.notifications
FOR SELECT
TO authenticated
USING (auth.uid () = user_id);

CREATE POLICY "notifications_update_own"
ON public.notifications
FOR UPDATE
TO authenticated
USING (auth.uid () = user_id)
WITH CHECK (auth.uid () = user_id);

-- Yorum bildirimi
CREATE OR REPLACE FUNCTION public.notify_post_comment ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_owner uuid;
BEGIN
  SELECT user_id INTO post_owner FROM public.posts WHERE id = NEW.post_id;

  IF post_owner IS NULL OR post_owner = NEW.user_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, actor_id, actor_name, type, post_id, comment_id)
  VALUES (post_owner, NEW.user_id, coalesce(nullif(trim(NEW.author), ''), 'Biri'), 'comment', NEW.post_id, NEW.id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_comment_notify ON public.comments;

CREATE TRIGGER on_comment_notify
AFTER INSERT ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.notify_post_comment ();

-- Beğeni bildirimi
CREATE OR REPLACE FUNCTION public.notify_post_like ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_owner uuid;
  actor_label text;
BEGIN
  SELECT user_id INTO post_owner FROM public.posts WHERE id = NEW.post_id;

  IF post_owner IS NULL OR post_owner = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(nullif(trim(display_name), ''), 'Biri')
  INTO actor_label
  FROM public.profiles
  WHERE id = NEW.user_id;

  IF actor_label IS NULL THEN
    actor_label := 'Biri';
  END IF;

  INSERT INTO public.notifications (user_id, actor_id, actor_name, type, post_id)
  VALUES (post_owner, NEW.user_id, actor_label, 'like', NEW.post_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_like_notify ON public.post_likes;

CREATE TRIGGER on_like_notify
AFTER INSERT ON public.post_likes
FOR EACH ROW
EXECUTE FUNCTION public.notify_post_like ();
