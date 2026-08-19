-- Gönderi ve yorum görünürlüğünü topluluk erişimine bağlar (RLS)
--
-- SORUN: posts_select_public ve comments_select_public politikaları USING (true) idi.
-- Gizlilik yalnızca arayüzde uygulanıyordu; anon anahtarla /rest/v1/posts?select=*
-- isteği atan herkes private topluluk gönderilerini ve içeriklerini okuyabiliyordu.
--
-- ÇÖZÜM: Görünürlük, mevcut is_community_public / is_community_member /
-- is_community_owner yardımcılarına bağlanır. Kullanıcı kendi içeriğini her zaman görür.
--
-- Önkoşul: supabase-community-posts.sql (yardımcı fonksiyonlar),
--          supabase-feed-edit.sql, supabase-comments-rls.sql
-- Supabase Dashboard → SQL Editor → bu dosyanın tamamını çalıştırın.
--
-- DİKKAT: supabase-feed-edit.sql veya supabase-comments-rls.sql dosyalarını daha sonra
-- tekrar çalıştırırsanız eski USING (true) politikaları geri gelir; bu durumda bu dosyayı
-- yeniden çalıştırın.

-- 1) Önkoşul kontrolü: yardımcılar yoksa hiçbir politikaya dokunmadan dur
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'is_community_public' AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'Onkosul eksik: public.is_community_public yok. Once supabase-community-posts.sql calistirin.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'is_community_member' AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'Onkosul eksik: public.is_community_member yok. Once supabase-community-posts.sql calistirin.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'is_community_owner' AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'Onkosul eksik: public.is_community_owner yok. Once supabase-community-posts.sql calistirin.';
  END IF;
END;
$$;

-- 2) Yorum politikası posts tablosuna bakacağı için SECURITY DEFINER yardımcı şart:
-- doğrudan alt sorgu kullanılsa posts RLS'i yeniden değerlendirilir ve döngü oluşur.
CREATE OR REPLACE FUNCTION public.can_view_post (p_post_id uuid)
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
        OR p.user_id = auth.uid()
        OR public.is_community_public(p.community_id)
        OR public.is_community_member(p.community_id)
        OR public.is_community_owner(p.community_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_post (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_post (uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.can_view_post (uuid) IS
  'Gönderi, çağıran kullanıcı için görünür mü? Yorum RLS politikasında kullanılır.';

-- 3) posts: gizli topluluk gönderileri yalnızca üyeye, kurucuya ve yazarına
DROP POLICY IF EXISTS "posts_select_public" ON public.posts;
DROP POLICY IF EXISTS "posts_select_visible" ON public.posts;

CREATE POLICY "posts_select_visible"
ON public.posts
FOR SELECT
TO anon, authenticated
USING (
  community_id IS NULL
  OR user_id = auth.uid()
  OR public.is_community_public(community_id)
  OR public.is_community_member(community_id)
  OR public.is_community_owner(community_id)
);

-- 4) comments: yorum, ait olduğu gönderi görünüyorsa görünür
DROP POLICY IF EXISTS "comments_select_public" ON public.comments;
DROP POLICY IF EXISTS "comments_select_visible" ON public.comments;

CREATE POLICY "comments_select_visible"
ON public.comments
FOR SELECT
TO anon, authenticated
USING (
  user_id = auth.uid()
  OR public.can_view_post(post_id)
);

-- 5) Doğrulama: SELECT politikaları
SELECT tablename, policyname, roles::text, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('posts', 'comments')
  AND cmd = 'SELECT'
ORDER BY tablename, policyname;

-- 6) Doğrulama: oturum açmamış ziyaretçinin görebileceği gönderi sayısı
-- (bu ortamda beklenen: 73 = 20 genel + 53 public topluluk; toplam 81)
SELECT
  count(*) FILTER (
    WHERE p.community_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.communities c
        WHERE c.id = p.community_id AND c.visibility = 'public'
      )
  ) AS ziyaretci_gorebilir,
  count(*) AS toplam_gonderi
FROM public.posts p;

-- GERİ ALMA (yalnızca gerekirse):
-- DROP POLICY IF EXISTS "posts_select_visible" ON public.posts;
-- CREATE POLICY "posts_select_public" ON public.posts
--   FOR SELECT TO authenticated, anon USING (true);
-- DROP POLICY IF EXISTS "comments_select_visible" ON public.comments;
-- CREATE POLICY "comments_select_public" ON public.comments
--   FOR SELECT TO authenticated, anon USING (true);
