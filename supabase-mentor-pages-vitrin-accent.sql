-- Mentör vitrin arka plan rengi (banner yerine)
-- supabase-mentor-pages.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS vitrin_accent text;

COMMENT ON COLUMN public.mentor_pages.vitrin_accent IS
  'Vitrin kartı arka plan rengi: blue, violet, indigo, sky, cyan, teal, mint, emerald, lime, gold, amber, orange, coral, rose, pink';
