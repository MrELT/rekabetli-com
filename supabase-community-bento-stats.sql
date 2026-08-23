-- Ana sayfa bento: topluluk sayısı, üye sayıları ve avatar (anon dahil)
-- Supabase SQL Editor'da bir kez çalıştırın.

DROP FUNCTION IF EXISTS public.get_communities_bento_stats ();
DROP FUNCTION IF EXISTS public.get_communities_bento_stats (int);

CREATE FUNCTION public.get_communities_bento_stats (p_limit int DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  name text,
  visibility text,
  member_count bigint,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    c.visibility,
    (
      SELECT COUNT(*)::bigint
      FROM public.community_members m
      WHERE m.community_id = c.id
    )
    + CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.community_members m
          WHERE m.community_id = c.id
            AND m.user_id = c.owner_id
        ) THEN 0::bigint
        ELSE 1::bigint
      END AS member_count,
    c.avatar_url
  FROM public.communities c
  ORDER BY member_count DESC, c.created_at DESC
  LIMIT CASE
    WHEN p_limit IS NULL THEN NULL
    ELSE GREATEST(1, LEAST(p_limit, 50))
  END;
$$;

GRANT EXECUTE ON FUNCTION public.get_communities_bento_stats (int) TO anon, authenticated;
