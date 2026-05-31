-- PDF Storage + academic_library_chunks metadata alanları
-- Supabase SQL Editor'da bir kez çalıştırın.

-- Orijinal PDF dosyaları (public okuma; yükleme politikası projeye göre ayarlanır)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'academic_pdfs',
  'academic_pdfs',
  true,
  52428800,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage politikaları (PostgreSQL CREATE POLICY IF NOT EXISTS desteklemez)
DROP POLICY IF EXISTS "academic_pdfs_public_read" ON storage.objects;
CREATE POLICY "academic_pdfs_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'academic_pdfs');

DROP POLICY IF EXISTS "academic_pdfs_anon_insert" ON storage.objects;
CREATE POLICY "academic_pdfs_anon_insert"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'academic_pdfs');

-- Tablo: pdf_url ve author (metadata yedek olarak jsonb'de de tutulur)
ALTER TABLE public.academic_library_chunks
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS author text;

COMMENT ON COLUMN public.academic_library_chunks.pdf_url IS
  'Supabase Storage academic_pdfs bucket public URL';
COMMENT ON COLUMN public.academic_library_chunks.author IS
  'AI veya kullanıcı kaynaklı yazar / kurum';

CREATE INDEX IF NOT EXISTS academic_library_chunks_pdf_url_idx
  ON public.academic_library_chunks (pdf_url)
  WHERE pdf_url IS NOT NULL;
