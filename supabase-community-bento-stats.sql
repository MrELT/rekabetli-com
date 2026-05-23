-- Ana sayfa bento: topluluk sayısı ve üye sayıları (anon dahil)
-- Supabase SQL Editor'da bir kez çalıştırın.

CREATE OR REPLACE FUNCTION public.get_communities_bento_stats ()
RETURNS TABLE (
  id uuid,
  name text,
  visibility text,
  member_count bigint
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
      END AS member_count
  FROM public.communities c
  ORDER BY member_count DESC, c.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_communities_bento_stats () TO anon, authenticated;
