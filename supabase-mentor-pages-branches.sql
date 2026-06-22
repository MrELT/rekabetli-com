-- Mentör vitrin: branşlar ve özel dersler (JSON)
-- supabase-mentor-pages.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS branches jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS private_lessons jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.mentor_pages
DROP CONSTRAINT IF EXISTS mentor_pages_branches_is_array;

ALTER TABLE public.mentor_pages
ADD CONSTRAINT mentor_pages_branches_is_array CHECK (jsonb_typeof(branches) = 'array');

ALTER TABLE public.mentor_pages
DROP CONSTRAINT IF EXISTS mentor_pages_private_lessons_is_array;

ALTER TABLE public.mentor_pages
ADD CONSTRAINT mentor_pages_private_lessons_is_array CHECK (jsonb_typeof(private_lessons) = 'array');

COMMENT ON COLUMN public.mentor_pages.branches IS
  'Mentörlük branşları: [{ id, title, description }]';

COMMENT ON COLUMN public.mentor_pages.private_lessons IS
  'Özel dersler: [{ id, title, description }]';
