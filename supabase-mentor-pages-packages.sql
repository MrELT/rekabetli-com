-- Mentör vitrin: paketler (başlık, içerik, fiyat)
-- supabase-mentor-pages-branches.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS packages jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.mentor_pages
DROP CONSTRAINT IF EXISTS mentor_pages_packages_is_array;

ALTER TABLE public.mentor_pages
ADD CONSTRAINT mentor_pages_packages_is_array CHECK (jsonb_typeof(packages) = 'array');

COMMENT ON COLUMN public.mentor_pages.packages IS
  'Mentörlük paketleri: [{ id, title, content, price }] — price TRY, brüt liste fiyatı.';
