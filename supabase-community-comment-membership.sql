-- Ana sayfa akışı: genel gönderiler + TÜM açık topluluk paylaşımları (üyelik şart değil)
-- /community sayfası yine yalnızca üyelere; üye olmayan banner → topluluklar kutucuğu
-- Topluluk yanıt/yorum için üyelik zorunlu (beğeni ve faydalılık hariç)
-- Üye sayısı: RLS'den bağımsız gerçek toplam
-- Önkoşul: is_community_member / is_community_owner (supabase-community-posts.sql veya rls-fix)

-- 1) Gerçek üye sayısı (liste RLS'inden bağımsız; anon dahil)
CREATE OR REPLACE FUNCTION public.get_community_member_count (p_community_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (
      SELECT COUNT(*)::bigint
      FROM public.community_members m
      WHERE m.community_id = p_community_id
    )
    + CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.communities c
          WHERE c.id = p_community_id
            AND NOT EXISTS (
              SELECT 1
              FROM public.community_members m
              WHERE m.community_id = c.id
                AND m.user_id = c.owner_id
            )
        ) THEN 1::bigint
        ELSE 0::bigint
      END;
$$;

GRANT EXECUTE ON FUNCTION public.get_community_member_count (uuid) TO authenticated, anon;

-- 2) Ana akış: genel + açık topluluk gönderileri (üyelik bağımsız)
CREATE OR REPLACE FUNCTION public.list_home_feed_posts (p_limit int DEFAULT NULL)
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
  community_owner_id uuid
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
    c.owner_id AS community_owner_id
  FROM public.posts p
  LEFT JOIN public.communities c ON c.id = p.community_id
  WHERE p.community_id IS NULL
    OR c.visibility = 'public'
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.list_home_feed_posts (int) TO authenticated, anon;

-- 3) Topluluk gönderisine yorum/yanıt: üye veya kurucu olmalı
CREATE OR REPLACE FUNCTION public.can_comment_on_post (p_post_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.posts p
    WHERE p.id = p_post_id
      AND (
        p.community_id IS NULL
        OR public.is_community_member (p.community_id)
        OR public.is_community_owner (p.community_id)
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_comment_on_post (uuid) TO authenticated, anon;

DROP POLICY IF EXISTS "comments_insert_authenticated" ON public.comments;

CREATE POLICY "comments_insert_authenticated"
ON public.comments
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid () = user_id
  AND public.can_comment_on_post (post_id)
);
