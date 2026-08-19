-- posts / comments üzerinde RLS'i fiilen devreye alır
--
-- NEDEN: supabase-feed-visibility-rls.sql çalıştırıldı ve can_view_post fonksiyonu
-- oluştu, ancak anon anahtarla ölçümde politikalar hiç değerlendirilmiyor:
--   posts    → anon 81 / service 81  (gizli topluluk gönderileri dahil)
--   comments → anon 154 / service 154
-- Karşılaştırma için community_members → anon 0 / service 454 (orada RLS çalışıyor).
--
-- İki olası neden var, bu dosya ikisini de kapatır:
--   (a) posts/comments tablolarında RLS kapalı → politikalar sessizce yok sayılır
--   (b) Panelden elle eklenmiş, USING (true) olan fazladan bir SELECT politikası
--       mevcut politikayla OR'lanıyor
--
-- Supabase Dashboard → SQL Editor → tamamını çalıştırın ve NOTICE çıktılarını okuyun.

-- 1) Mevcut durumu raporla (hiçbir şeyi değiştirmeden)
DO $$
DECLARE
  r record;
BEGIN
  RAISE NOTICE '--- Mevcut RLS durumu ---';
  FOR r IN
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname IN ('posts', 'comments', 'community_members')
    ORDER BY c.relname
  LOOP
    RAISE NOTICE 'tablo=% rls_acik=% rls_zorunlu=%',
      r.relname, r.relrowsecurity, r.relforcerowsecurity;
  END LOOP;

  RAISE NOTICE '--- Mevcut SELECT politikalari ---';
  FOR r IN
    SELECT tablename, policyname, permissive, roles::text AS roles, qual
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('posts', 'comments')
      AND cmd = 'SELECT'
    ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE 'tablo=% politika=% tip=% roller=% kosul=%',
      r.tablename, r.policyname, r.permissive, r.roles, r.qual;
  END LOOP;
END;
$$;

-- 2) Görünürlük politikalarını (yeniden) kur — dosya tek başına çalışabilsin
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

DROP POLICY IF EXISTS "comments_select_visible" ON public.comments;

CREATE POLICY "comments_select_visible"
ON public.comments
FOR SELECT
TO anon, authenticated
USING (
  user_id = auth.uid()
  OR public.can_view_post(post_id)
);

-- 3) Fazladan izin veren SELECT politikalarını kaldır (senaryo b)
-- Permissive politikalar OR'lanır: USING (true) olan tek bir politika kalırsa
-- görünürlük kısıtı tamamen etkisiz kalır.
DO $$
DECLARE
  r record;
  silinen integer := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('posts', 'comments')
      AND cmd = 'SELECT'
      AND policyname NOT IN ('posts_select_visible', 'comments_select_visible')
  LOOP
    RAISE NOTICE 'Fazladan SELECT politikasi kaldiriliyor: %.%', r.tablename, r.policyname;
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    silinen := silinen + 1;
  END LOOP;

  IF silinen = 0 THEN
    RAISE NOTICE 'Fazladan SELECT politikasi bulunmadi (senaryo b degil).';
  END IF;
END;
$$;

-- 4) GÜVENLİK AĞI: RLS açılmadan önce yazma politikalarının varlığını doğrula.
-- Eksik politikayla RLS açmak kullanıcıların gönderi/yorum ekleyememesine yol açar.
DO $$
DECLARE
  eksik text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='posts' AND cmd='INSERT') THEN
    eksik := eksik || 'posts:INSERT ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='posts' AND cmd='UPDATE') THEN
    eksik := eksik || 'posts:UPDATE ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='posts' AND cmd='DELETE') THEN
    eksik := eksik || 'posts:DELETE ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comments' AND cmd='INSERT') THEN
    eksik := eksik || 'comments:INSERT ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comments' AND cmd='UPDATE') THEN
    eksik := eksik || 'comments:UPDATE ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comments' AND cmd='DELETE') THEN
    eksik := eksik || 'comments:DELETE ';
  END IF;

  IF eksik <> '' THEN
    RAISE EXCEPTION 'RLS acilmadi. Eksik yazma politikalari: %. Once supabase-feed-edit.sql ve supabase-comments-rls.sql calistirin.', eksik;
  END IF;

  RAISE NOTICE 'Yazma politikalari tam; RLS guvenle acilabilir.';
END;
$$;

-- 5) RLS'i aç (senaryo a). Zaten açıksa bu komut bir şeyi değiştirmez.
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- 6) Sonuç raporu
DO $$
DECLARE
  r record;
BEGIN
  RAISE NOTICE '--- Islem sonrasi durum ---';
  FOR r IN
    SELECT c.relname, c.relrowsecurity
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname IN ('posts', 'comments')
    ORDER BY c.relname
  LOOP
    RAISE NOTICE 'tablo=% rls_acik=%', r.relname, r.relrowsecurity;
  END LOOP;
END;
$$;

-- 7) Doğrulama: politika listesi
SELECT tablename, policyname, cmd, roles::text AS roller
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('posts', 'comments')
ORDER BY tablename, cmd, policyname;

-- 8) Doğrulama: ziyaretçinin görmesi gereken gönderi sayısı
-- (bu ortamda beklenen: 73 görünür / 81 toplam)
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

-- GERİ ALMA (yalnızca akış bozulursa):
-- ALTER TABLE public.posts DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.comments DISABLE ROW LEVEL SECURITY;
