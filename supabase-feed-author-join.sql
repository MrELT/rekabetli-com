-- Akış yazar bilgisi: posts/comments → profiles ilişkisi (JOIN)
-- Ana sayfa ve topluluk akışı, yazar adı/avatarı için artık ayrı bir profiles
-- isteği atmıyor; bilgiyi gönderiyle aynı sorguda ilişkisel olarak çekiyor.
-- Önkoşul: supabase-profile-fields.sql, supabase-post-actions.sql,
-- supabase-comments-rls.sql, supabase-community-comment-membership.sql
-- Supabase Dashboard → SQL Editor → bu dosyanın tamamını çalıştırın.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_mentor boolean NOT NULL DEFAULT false;

-- 1) FK öncesi: yazarı olan ama profil satırı olmayan kullanıcıları tamamla
INSERT INTO public.profiles (id, email, display_name)
SELECT
  u.id,
  u.email,
  nullif(
    trim(
      coalesce(u.raw_user_meta_data ->> 'first_name', '') || ' ' ||
      coalesce(u.raw_user_meta_data ->> 'last_name', '')
    ),
    ''
  )
FROM auth.users u
WHERE u.id IN (
    SELECT p.user_id FROM public.posts p WHERE p.user_id IS NOT NULL
    UNION
    SELECT c.user_id FROM public.comments c WHERE c.user_id IS NOT NULL
  )
ON CONFLICT (id) DO NOTHING;

-- 2) PostgREST'in ilişkisel sorgu (embed) yapabilmesi için foreign key
-- NOT VALID ile eklenir: mevcut satırlar sorguyu kilitlemez, ilişki hemen tanınır.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_user_id_profiles_fkey'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
    ADD CONSTRAINT posts_user_id_profiles_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE NOT VALID;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'comments_user_id_profiles_fkey'
      AND conrelid = 'public.comments'::regclass
  ) THEN
    ALTER TABLE public.comments
    ADD CONSTRAINT comments_user_id_profiles_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE NOT VALID;
  END IF;
END;
$$;

-- Artık geçerli olan kısıtları doğrula; artakalan tutarsızlık varsa uyarı bırak
DO $$
BEGIN
  ALTER TABLE public.posts VALIDATE CONSTRAINT posts_user_id_profiles_fkey;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'posts_user_id_profiles_fkey dogrulanamadi: %', SQLERRM;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.comments VALIDATE CONSTRAINT comments_user_id_profiles_fkey;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'comments_user_id_profiles_fkey dogrulanamadi: %', SQLERRM;
END;
$$;

-- 3) JOIN performansı için yazar indeksleri
CREATE INDEX IF NOT EXISTS posts_user_id_idx
ON public.posts (user_id);

CREATE INDEX IF NOT EXISTS comments_user_id_idx
ON public.comments (user_id);

-- 4) Ana akış RPC'si yazar bilgisini de döndürsün (istemci ikinci istek atmasın)
DROP FUNCTION IF EXISTS public.list_home_feed_posts (int);

CREATE FUNCTION public.list_home_feed_posts (p_limit int DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  author text,
  title text,
  content text,
  created_at timestamptz,
  updated_at timestamptz,
  community_id uuid,
  community_name text,
  community_visibility text,
  community_owner_id uuid,
  author_display_name text,
  author_avatar_url text,
  author_is_mentor boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.user_id,
    p.author,
    p.title,
    p.content,
    p.created_at,
    p.updated_at,
    p.community_id,
    c.name AS community_name,
    c.visibility AS community_visibility,
    c.owner_id AS community_owner_id,
    pr.display_name AS author_display_name,
    pr.avatar_url AS author_avatar_url,
    coalesce(pr.is_mentor, false) AS author_is_mentor
  FROM public.posts p
  LEFT JOIN public.communities c ON c.id = p.community_id
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  WHERE p.community_id IS NULL
    OR c.visibility = 'public'
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.list_home_feed_posts (int) TO authenticated, anon;

COMMENT ON FUNCTION public.list_home_feed_posts (int) IS
  'Ana sayfa akışı: genel + açık topluluk gönderileri, yazar profili JOIN edilmiş halde.';

-- 5) PostgREST şema önbelleğini yenile: yeni ilişki hemen embed edilebilsin
NOTIFY pgrst, 'reload schema';
