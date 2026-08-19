-- profiles.user_code erişimini kilitler
--
-- SORUN: user_code (RKL-XXXXXX) kolonu anon ve authenticated rollerine açık.
-- Ölçüm: oturum açmamış bir ziyaretçi 211 kullanıcının kodunu tek istekle okuyabiliyordu.
-- Oysa kolonun kendi açıklaması "Mentör paneline davet için paylaşılır" diyor ve
-- link_student_by_user_code fonksiyonu, kodu bilen bir mentöre o kullanıcıyı
-- öğrenci olarak ekleme yetkisi veriyor (öğrencinin onayı istenmiyor).
-- Yani gizli olması varsayılan bir davet anahtarı herkese açıktı.
--
-- Bu kolonu okuyan istemci kodu yok: profile.js içindeki applyUserCodeDisplay
-- fonksiyonu hiç çağrılmıyor ve profile.html içinde karşılığı olan element yok.
-- link_student_by_user_code ise SECURITY DEFINER olduğu için kolon iznine
-- ihtiyaç duymaz; kilitleme sonrası çalışmaya devam eder.
--
-- Not: is_mentor alanı protect_profile_privileged_columns trigger'ı ile korunuyor,
-- yalnızca yönetici değiştirebiliyor. Dolayısıyla bu yetkiyi ele geçirmek için
-- kullanıcının kendini mentör ilan etmesi mümkün değil.
--
-- Önkoşul: supabase-profile-pii-lockdown.sql
-- Supabase Dashboard → SQL Editor → tamamını çalıştırın.

-- 1) Mevcut durumu raporla
DO $$
BEGIN
  RAISE NOTICE '--- ONCE ---';
  RAISE NOTICE 'anon          → user_code: %', has_column_privilege('anon', 'public.profiles', 'user_code', 'SELECT');
  RAISE NOTICE 'authenticated → user_code: %', has_column_privilege('authenticated', 'public.profiles', 'user_code', 'SELECT');
END;
$$;

-- 2) Kullanıcı kendi kodunu bu fonksiyondan alabilsin
-- (Şu an arayüzde gösterilmiyor; özellik tamamlandığında hazır olsun.)
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
    'is_mentor', p.is_mentor,
    'user_code', p.user_code
  )
  FROM public.profiles AS p
  WHERE p.id = auth.uid();
$$;

-- 3) Kolon iznini geri al
REVOKE SELECT (user_code) ON public.profiles FROM anon;
REVOKE SELECT (user_code) ON public.profiles FROM authenticated;

-- 4) Derinlemesine savunma: Supabase yeni fonksiyonlara varsayılan olarak anon
-- için de EXECUTE veriyor. Bu fonksiyonların anon tarafından çağrılması anlamsız;
-- koruma zaten fonksiyon içinde ama kapıyı da kapatıyoruz.
REVOKE EXECUTE ON FUNCTION public.get_my_contact_info () FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_profiles (uuid[], boolean, integer) FROM anon;

-- 5) Sonuç raporu
DO $$
BEGIN
  RAISE NOTICE '--- SONRA ---';
  RAISE NOTICE 'anon          → user_code: % (false olmali)', has_column_privilege('anon', 'public.profiles', 'user_code', 'SELECT');
  RAISE NOTICE 'authenticated → user_code: % (false olmali)', has_column_privilege('authenticated', 'public.profiles', 'user_code', 'SELECT');
  RAISE NOTICE 'anon → display_name: % (true olmali)', has_column_privilege('anon', 'public.profiles', 'display_name', 'SELECT');
  RAISE NOTICE 'anon → is_mentor: % (true olmali)', has_column_privilege('anon', 'public.profiles', 'is_mentor', 'SELECT');
END;
$$;

NOTIFY pgrst, 'reload schema';

-- GERİ ALMA (yalnızca gerekirse):
-- GRANT SELECT (user_code) ON public.profiles TO anon, authenticated;
