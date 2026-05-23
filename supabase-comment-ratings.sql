-- Cevap faydalılık puanları (1–5)
-- Supabase SQL Editor'da çalıştırın (comments ve profiles tabloları hazır olmalı).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS answer_rating_sum bigint NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS answer_rating_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.comment_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.comments (id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  rater_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  score smallint NOT NULL CHECK (score >= 1 AND score <= 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, rater_user_id)
);

CREATE INDEX IF NOT EXISTS comment_ratings_comment_id_idx ON public.comment_ratings (comment_id);
CREATE INDEX IF NOT EXISTS comment_ratings_author_user_id_idx ON public.comment_ratings (author_user_id);

CREATE OR REPLACE FUNCTION public.comment_ratings_set_author()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  comment_author uuid;
BEGIN
  SELECT user_id INTO comment_author
  FROM public.comments
  WHERE id = NEW.comment_id;

  IF comment_author IS NULL THEN
    RAISE EXCEPTION 'Bu yanıt henüz bir kullanıcıya bağlı değil; puan verilemez.';
  END IF;

  IF comment_author = NEW.rater_user_id THEN
    RAISE EXCEPTION 'Kendi yanıtınıza puan veremezsiniz.';
  END IF;

  NEW.author_user_id := comment_author;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_author_answer_rating_stats(p_author_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_author_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.profiles
  SET
    answer_rating_sum = COALESCE((
      SELECT SUM(score)::bigint
      FROM public.comment_ratings
      WHERE author_user_id = p_author_id
    ), 0),
    answer_rating_count = COALESCE((
      SELECT COUNT(*)::integer
      FROM public.comment_ratings
      WHERE author_user_id = p_author_id
    ), 0)
  WHERE id = p_author_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.comment_ratings_sync_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.refresh_author_answer_rating_stats(NEW.author_user_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.author_user_id IS DISTINCT FROM NEW.author_user_id THEN
      PERFORM public.refresh_author_answer_rating_stats(OLD.author_user_id);
    END IF;
    PERFORM public.refresh_author_answer_rating_stats(NEW.author_user_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_author_answer_rating_stats(OLD.author_user_id);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS comment_ratings_set_author_trg ON public.comment_ratings;
CREATE TRIGGER comment_ratings_set_author_trg
BEFORE INSERT OR UPDATE ON public.comment_ratings
FOR EACH ROW
EXECUTE FUNCTION public.comment_ratings_set_author();

DROP TRIGGER IF EXISTS comment_ratings_sync_profile_trg ON public.comment_ratings;
CREATE TRIGGER comment_ratings_sync_profile_trg
AFTER INSERT OR UPDATE OR DELETE ON public.comment_ratings
FOR EACH ROW
EXECUTE FUNCTION public.comment_ratings_sync_profile();

ALTER TABLE public.comment_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comment_ratings_select_authenticated" ON public.comment_ratings;
DROP POLICY IF EXISTS "comment_ratings_select_public" ON public.comment_ratings;
DROP POLICY IF EXISTS "comment_ratings_insert_own" ON public.comment_ratings;
DROP POLICY IF EXISTS "comment_ratings_update_own" ON public.comment_ratings;
DROP POLICY IF EXISTS "comment_ratings_delete_own" ON public.comment_ratings;

-- Ortalamalar herkese görünsün; puan vermek için giriş gerekir.
CREATE POLICY "comment_ratings_select_public"
ON public.comment_ratings
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "comment_ratings_insert_own"
ON public.comment_ratings
FOR INSERT
TO authenticated
WITH CHECK (auth.uid () = rater_user_id);

CREATE POLICY "comment_ratings_update_own"
ON public.comment_ratings
FOR UPDATE
TO authenticated
USING (auth.uid () = rater_user_id)
WITH CHECK (auth.uid () = rater_user_id);

CREATE POLICY "comment_ratings_delete_own"
ON public.comment_ratings
FOR DELETE
TO authenticated
USING (auth.uid () = rater_user_id);
