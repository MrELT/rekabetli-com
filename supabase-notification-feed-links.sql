-- Beğeni bildirimlerine community_id ekle (topluluk paylaşımlarında doğru bağlantı için)
-- Supabase SQL Editor'da bir kez çalıştırın.

CREATE OR REPLACE FUNCTION public.notify_post_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_owner uuid;
  v_community_id uuid;
  actor_label text;
BEGIN
  SELECT p.user_id, p.community_id
  INTO post_owner, v_community_id
  FROM public.posts AS p
  WHERE p.id = NEW.post_id;

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

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    post_id,
    community_id
  )
  VALUES (
    post_owner,
    NEW.user_id,
    actor_label,
    'like',
    NEW.post_id,
    v_community_id
  );

  RETURN NEW;
END;
$$;
