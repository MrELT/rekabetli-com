-- Gönderi ve yorum düzenleme: updated_at + güvenli UPDATE politikaları
-- Supabase SQL Editor'da bir kez çalıştırın.
--
-- NOT: posts tablosunda RLS bu dosyayla birlikte açılıyor. RLS açılınca
-- tüm işlemler için policy gerektiğinden SELECT/INSERT/UPDATE/DELETE
-- politikalarının tamamı aşağıda tanımlıdır. Eksik policy, akışın boş
-- görünmesine veya "Kaydedilemedi" hatasına yol açar.

ALTER TABLE public.posts
ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.comments
ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.posts_prevent_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR OLD.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'posts_update_forbidden';
  END IF;

  NEW.user_id := OLD.user_id;
  NEW.author := OLD.author;
  NEW.community_id := OLD.community_id;
  NEW.created_at := OLD.created_at;

  IF NEW.title IS DISTINCT FROM OLD.title OR NEW.content IS DISTINCT FROM OLD.content THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_prevent_identity_change_row ON public.posts;

CREATE TRIGGER posts_prevent_identity_change_row
BEFORE UPDATE ON public.posts
FOR EACH ROW
EXECUTE FUNCTION public.posts_prevent_identity_change();

CREATE OR REPLACE FUNCTION public.comments_prevent_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR OLD.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'comments_update_forbidden';
  END IF;

  NEW.user_id := OLD.user_id;
  NEW.author := OLD.author;
  NEW.post_id := OLD.post_id;
  NEW.parent_comment_id := OLD.parent_comment_id;

  IF NEW.content IS DISTINCT FROM OLD.content THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;

  RETURN NEW;
END;
$$;

-- comments UPDATE trigger'ı (fonksiyon yukarıda; trigger yoksa oluştur)
DROP TRIGGER IF EXISTS comments_prevent_identity_change_row ON public.comments;

CREATE TRIGGER comments_prevent_identity_change_row
BEFORE UPDATE ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.comments_prevent_identity_change();

-- comments için gerekli RLS politikaları (RLS açık; UPDATE policy şarttı)
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_select_public" ON public.comments;
DROP POLICY IF EXISTS "comments_update_own" ON public.comments;

CREATE POLICY "comments_select_public"
ON public.comments
FOR SELECT
TO authenticated, anon
USING (true);

CREATE POLICY "comments_update_own"
ON public.comments
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- posts için tüm RLS politikaları (RLS açık olduğu için hepsi gerekli)
DROP POLICY IF EXISTS "posts_select_public" ON public.posts;
DROP POLICY IF EXISTS "posts_insert_own" ON public.posts;
DROP POLICY IF EXISTS "posts_update_own" ON public.posts;
DROP POLICY IF EXISTS "posts_delete_own" ON public.posts;

CREATE POLICY "posts_select_public"
ON public.posts
FOR SELECT
TO authenticated, anon
USING (true);

CREATE POLICY "posts_insert_own"
ON public.posts
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "posts_update_own"
ON public.posts
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "posts_delete_own"
ON public.posts
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
