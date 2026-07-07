-- Mentör görüşme bağlantısı (Google Meet / Zoom)
-- supabase-mentor-pages.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS meeting_platform text,
ADD COLUMN IF NOT EXISTS meeting_link text;

ALTER TABLE public.mentor_pages
DROP CONSTRAINT IF EXISTS mentor_pages_meeting_platform_check;

ALTER TABLE public.mentor_pages
ADD CONSTRAINT mentor_pages_meeting_platform_check CHECK (
  meeting_platform IS NULL
  OR meeting_platform IN ('google_meet', 'zoom')
);

ALTER TABLE public.mentor_pages
DROP CONSTRAINT IF EXISTS mentor_pages_meeting_link_len;

ALTER TABLE public.mentor_pages
ADD CONSTRAINT mentor_pages_meeting_link_len CHECK (
  meeting_link IS NULL
  OR char_length(meeting_link) <= 500
);

COMMENT ON COLUMN public.mentor_pages.meeting_platform IS
  'google_meet veya zoom';
COMMENT ON COLUMN public.mentor_pages.meeting_link IS
  'Öğrenci görüşmeleri için Meet veya Zoom bağlantısı';
