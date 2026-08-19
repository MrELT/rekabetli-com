-- profiles.email / profiles.phone erişimini kilitler
--
-- SORUN: supabase-security-high-priority-fixes.sql iki parçayı birlikte kuruyor:
--   GRANT SELECT (email, phone) ON public.profiles TO authenticated;
--   CREATE POLICY "profiles_select_public" ... USING (true);
-- Kolon izni tüm authenticated rolüne verildiği, RLS politikası da tüm satırları
-- açtığı için giriş yapmış herhangi bir kullanıcı bütün kullanıcıların e-posta ve
-- telefonunu tek istekle okuyabiliyor. Aynı dosyadaki profiles_select_own_sensitive
-- politikası bunu engellemiyor: permissive politikalar OR'lanır, USING (true) varken
-- diğerleri etkisiz kalır. RLS satır düzeyinde çalıştığı için "yalnızca kendi
-- e-postan" kuralını kolon bazında uygulayamaz.
--
-- ÇÖZÜM: Kolon iznini geri al, erişimi iki SECURITY DEFINER fonksiyona indir:
--   get_my_contact_info() → yalnızca çağıranın kendi bilgisi
--   admin_list_profiles() → yalnızca admin, is_admin_user() ile doğrulanır
--
-- ÖNEMLİ SIRA: Bu dosya çalıştırılmadan önce güncellenmiş admin.js,
-- mentorship-request.js, mentor-application.js ve package-request.js dosyaları
-- devrede olmalı. Aksi halde yönetim paneli e-posta kolonunu okuyamaz.
--
-- Supabase Dashboard → SQL Editor → tamamını çalıştırın, NOTICE çıktısını okuyun.

-- 1) Mevcut durumu raporla
DO $$
BEGIN
  RAISE NOTICE '--- ONCE: hassas kolonlari kim okuyabiliyor? ---';
  RAISE NOTICE 'authenticated → email: %', has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT');
  RAISE NOTICE 'authenticated → phone: %', has_column_privilege('authenticated', 'public.profiles', 'phone', 'SELECT');
  RAISE NOTICE 'anon          → email: %', has_column_privilege('anon', 'public.profiles', 'email', 'SELECT');
  RAISE NOTICE 'anon          → phone: %', has_column_privilege('anon', 'public.profiles', 'phone', 'SELECT');
END;
$$;

-- 2) Kullanıcının kendi iletişim bilgisi
-- Formları ön-doldurmak için gerekiyor (mentorluk başvurusu, paket talebi).
CREATE OR REPLACE FUNCTION public.get_my_contact_info ()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'email', p.email,
    'phone', p.phone,
    'user_type', p.user_type,
    'is_mentor', p.is_mentor
  )
  FROM public.profiles AS p
  WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_contact_info () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_contact_info () TO authenticated;

COMMENT ON FUNCTION public.get_my_contact_info () IS
  'Yalnızca çağıran kullanıcının kendi profil ve iletişim bilgisini döndürür.';

-- 3) Yönetim paneli için profil listesi
-- p_ids verilirse yalnızca o kullanıcılar, p_only_mentors ise yalnızca mentörler.
CREATE OR REPLACE FUNCTION public.admin_list_profiles (
  p_ids uuid[] DEFAULT NULL,
  p_only_mentors boolean DEFAULT false,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  id uuid,
  display_name text,
  email text,
  phone text,
  user_type text,
  is_mentor boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user (auth.uid ()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.display_name,
    p.email,
    p.phone,
    p.user_type,
    p.is_mentor,
    p.updated_at
  FROM public.profiles AS p
  WHERE (p_ids IS NULL OR p.id = ANY (p_ids))
    AND (NOT p_only_mentors OR p.is_mentor)
  ORDER BY p.updated_at DESC NULLS LAST
  LIMIT greatest(
    least(coalesce(p_limit, 500), 1000),
    coalesce(array_length(p_ids, 1), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_profiles (uuid[], boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles (uuid[], boolean, integer) TO authenticated;

COMMENT ON FUNCTION public.admin_list_profiles (uuid[], boolean, integer) IS
  'Yonetim paneli icin profil listesi. Yalnizca admin_users tablosundaki kullanicilar cagirabilir.';

-- 4) Kolon iznini geri al
REVOKE SELECT (email) ON public.profiles FROM authenticated;
REVOKE SELECT (phone) ON public.profiles FROM authenticated;
REVOKE SELECT (email) ON public.profiles FROM anon;
REVOKE SELECT (phone) ON public.profiles FROM anon;

-- 5) Sonuç raporu
DO $$
BEGIN
  RAISE NOTICE '--- SONRA: hassas kolonlari kim okuyabiliyor? ---';
  RAISE NOTICE 'authenticated → email: % (false olmali)', has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT');
  RAISE NOTICE 'authenticated → phone: % (false olmali)', has_column_privilege('authenticated', 'public.profiles', 'phone', 'SELECT');
  RAISE NOTICE 'anon          → email: % (false olmali)', has_column_privilege('anon', 'public.profiles', 'email', 'SELECT');

  RAISE NOTICE '--- Herkese acik kolonlar hala okunabilir olmali ---';
  RAISE NOTICE 'anon → display_name: % (true olmali)', has_column_privilege('anon', 'public.profiles', 'display_name', 'SELECT');
  RAISE NOTICE 'anon → avatar_url: % (true olmali)', has_column_privilege('anon', 'public.profiles', 'avatar_url', 'SELECT');
  RAISE NOTICE 'authenticated → display_name: % (true olmali)', has_column_privilege('authenticated', 'public.profiles', 'display_name', 'SELECT');
END;
$$;

NOTIFY pgrst, 'reload schema';

-- GERİ ALMA (yalnızca yönetim paneli veya formlar bozulursa):
-- GRANT SELECT (email, phone) ON public.profiles TO authenticated;
