-- post_saves / post_likes / comment_ratings gizliliğini kısıtlar
--
-- SORUN: Üç tablonun da SELECT politikası USING (true) idi. Ölçüm (anon anahtar):
--   post_saves     14 satır → kimin hangi gönderiyi kaydettiği herkese açık
--   post_likes    232 satır → kimin neyi beğendiği, gizli gönderiler dahil
--   comment_ratings 181 satır → kimin hangi yanıta kaç puan verdiği
--
-- ÇÖZÜM (arayüzü bozmayan en dar kapsam):
--   post_saves      → yalnızca kendi kayıtları. Arayüz kaydetme sayısı göstermiyor
--                     (buildSavedSet yalnızca kendi satırlarını süzüyor), bu yüzden
--                     tam kısıtlama mümkün.
--   post_likes      → yalnızca görünür gönderilerin beğenileri. Beğeni sayısı
--                     arayüzde gösterildiği için satırlar gizlenemiyor; gizli
--                     topluluk gönderilerinin beğeni verisi kapatılıyor.
--   comment_ratings → yalnızca görünür yorumların puanları (ortalama hesabı için
--                     gerekli) ve her zaman kendi verdiği puan.
--
-- Kimin ne beğendiğini/puanladığını tamamen gizlemek için toplamları döndüren
-- fonksiyonlar gerekir; bu ayrı bir adım olarak bilinçli şekilde ertelendi.
--
-- Önkoşul: supabase-feed-visibility-rls.sql (can_view_post)
-- Supabase Dashboard → SQL Editor → tamamını çalıştırın, NOTICE çıktısını okuyun.

-- 1) Mevcut durumu raporla
DO $$
DECLARE
  r record;
BEGIN
  RAISE NOTICE '--- ONCE: RLS durumu ---';
  FOR r IN
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname IN ('post_likes', 'post_saves', 'comment_ratings')
    ORDER BY c.relname
  LOOP
    RAISE NOTICE 'tablo=% rls_acik=%', r.relname, r.relrowsecurity;
  END LOOP;

  RAISE NOTICE '--- ONCE: SELECT politikalari ---';
  FOR r IN
    SELECT tablename, policyname, qual
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('post_likes', 'post_saves', 'comment_ratings')
      AND cmd = 'SELECT'
    ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE 'tablo=% politika=% kosul=%', r.tablename, r.policyname, r.qual;
  END LOOP;
END;
$$;

-- 2) Önkoşul kontrolü
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'can_view_post' AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'Onkosul eksik: public.can_view_post yok. Once supabase-feed-visibility-rls.sql calistirin.';
  END IF;
END;
$$;

-- 3) Yorum görünürlüğü yardımcısı
-- comment_ratings politikası comments tablosuna bakacağı için SECURITY DEFINER şart:
-- doğrudan alt sorgu kullanılsa comments RLS'i yeniden değerlendirilir.
CREATE OR REPLACE FUNCTION public.can_view_comment (p_comment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comments AS c
    WHERE c.id = p_comment_id
      AND (
        c.user_id = auth.uid()
        OR public.can_view_post(c.post_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_comment (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_comment (uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.can_view_comment (uuid) IS
  'Yorum, cagiran kullanici icin gorunur mu? comment_ratings RLS politikasinda kullanilir.';

-- 4) post_saves: yalnızca kendi kayıtları
DROP POLICY IF EXISTS "post_saves_select" ON public.post_saves;
DROP POLICY IF EXISTS "post_saves_select_own" ON public.post_saves;

CREATE POLICY "post_saves_select_own"
ON public.post_saves
FOR SELECT
TO authenticated
USING (user_id = auth.uid ());

-- 5) post_likes: yalnızca görünür gönderilerin beğenileri
DROP POLICY IF EXISTS "post_likes_select" ON public.post_likes;
DROP POLICY IF EXISTS "post_likes_select_visible" ON public.post_likes;

CREATE POLICY "post_likes_select_visible"
ON public.post_likes
FOR SELECT
TO anon, authenticated
USING (
  user_id = auth.uid ()
  OR public.can_view_post (post_id)
);

-- 6) comment_ratings: görünür yorumların puanları + kendi puanı
DROP POLICY IF EXISTS "comment_ratings_select_public" ON public.comment_ratings;
DROP POLICY IF EXISTS "comment_ratings_select_authenticated" ON public.comment_ratings;
DROP POLICY IF EXISTS "comment_ratings_select_visible" ON public.comment_ratings;

CREATE POLICY "comment_ratings_select_visible"
ON public.comment_ratings
FOR SELECT
TO anon, authenticated
USING (
  rater_user_id = auth.uid ()
  OR public.can_view_comment (comment_id)
);

-- 7) Fazladan izin veren SELECT politikalarını kaldır
-- Permissive politikalar OR'lanır: USING (true) olan tek bir politika kalırsa
-- yukarıdaki kısıtlar tamamen etkisiz olur.
DO $$
DECLARE
  r record;
  silinen integer := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('post_likes', 'post_saves', 'comment_ratings')
      AND cmd = 'SELECT'
      AND policyname NOT IN (
        'post_saves_select_own',
        'post_likes_select_visible',
        'comment_ratings_select_visible'
      )
  LOOP
    RAISE NOTICE 'Fazladan SELECT politikasi kaldiriliyor: %.%', r.tablename, r.policyname;
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    silinen := silinen + 1;
  END LOOP;

  IF silinen = 0 THEN
    RAISE NOTICE 'Fazladan SELECT politikasi bulunmadi.';
  END IF;
END;
$$;

-- 8) GÜVENLİK AĞI: RLS açılmadan önce yazma politikaları yerinde mi?
-- Eksik politikayla RLS açmak begenme/kaydetme/puanlama islemlerini kirar.
DO $$
DECLARE
  eksik text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='post_likes' AND cmd='INSERT') THEN
    eksik := eksik || 'post_likes:INSERT ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='post_likes' AND cmd='DELETE') THEN
    eksik := eksik || 'post_likes:DELETE ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='post_saves' AND cmd='INSERT') THEN
    eksik := eksik || 'post_saves:INSERT ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='post_saves' AND cmd='DELETE') THEN
    eksik := eksik || 'post_saves:DELETE ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comment_ratings' AND cmd='INSERT') THEN
    eksik := eksik || 'comment_ratings:INSERT ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comment_ratings' AND cmd='UPDATE') THEN
    eksik := eksik || 'comment_ratings:UPDATE ';
  END IF;

  IF eksik <> '' THEN
    RAISE EXCEPTION 'RLS acilmadi. Eksik yazma politikalari: %. Once supabase-post-actions.sql ve supabase-comment-ratings.sql calistirin.', eksik;
  END IF;

  RAISE NOTICE 'Yazma politikalari tam; RLS guvenle acilabilir.';
END;
$$;

-- 9) RLS'i aç (zaten açıksa bir şeyi değiştirmez)
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_ratings ENABLE ROW LEVEL SECURITY;

-- 10) Sonuç raporu
DO $$
DECLARE
  r record;
BEGIN
  RAISE NOTICE '--- SONRA: RLS durumu ---';
  FOR r IN
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname IN ('post_likes', 'post_saves', 'comment_ratings')
    ORDER BY c.relname
  LOOP
    RAISE NOTICE 'tablo=% rls_acik=%', r.relname, r.relrowsecurity;
  END LOOP;
END;
$$;

-- 11) Doğrulama: ziyaretçinin görebileceği satır sayıları
-- (bu ortamda beklenen: post_saves 0, post_likes ve comment_ratings gizli
--  icerige ait olanlar dusmus halde)
SELECT
  (SELECT count(*) FROM public.post_saves) AS post_saves_toplam,
  (SELECT count(*) FROM public.post_likes) AS post_likes_toplam,
  (
    SELECT count(*)
    FROM public.post_likes AS pl
    JOIN public.posts AS p ON p.id = pl.post_id
    WHERE p.community_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.communities c
        WHERE c.id = p.community_id AND c.visibility = 'public'
      )
  ) AS post_likes_ziyaretci_gorebilir,
  (SELECT count(*) FROM public.comment_ratings) AS comment_ratings_toplam;

-- GERİ ALMA (yalnızca akış bozulursa):
-- DROP POLICY IF EXISTS "post_saves_select_own" ON public.post_saves;
-- CREATE POLICY "post_saves_select" ON public.post_saves FOR SELECT TO authenticated, anon USING (true);
-- DROP POLICY IF EXISTS "post_likes_select_visible" ON public.post_likes;
-- CREATE POLICY "post_likes_select" ON public.post_likes FOR SELECT TO authenticated, anon USING (true);
-- DROP POLICY IF EXISTS "comment_ratings_select_visible" ON public.comment_ratings;
-- CREATE POLICY "comment_ratings_select_public" ON public.comment_ratings FOR SELECT TO anon, authenticated USING (true);
