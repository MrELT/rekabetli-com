-- Forum görselleri: forum-attachments bucket (Quill editör yüklemeleri)
-- Supabase SQL Editor'da çalıştırın. Bucket zaten varsa yalnızca politikalar uygulanır.

INSERT INTO storage.buckets (id, name, public)
VALUES ('forum-attachments', 'forum-attachments', true)
ON CONFLICT (id) DO UPDATE
SET public = true;

DROP POLICY IF EXISTS "forum_attachments_public_read" ON storage.objects;
DROP POLICY IF EXISTS "forum_attachments_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "forum_attachments_update_own" ON storage.objects;
DROP POLICY IF EXISTS "forum_attachments_delete_own" ON storage.objects;

CREATE POLICY "forum_attachments_public_read"
ON storage.objects
FOR SELECT
TO authenticated, anon
USING (bucket_id = 'forum-attachments');

CREATE POLICY "forum_attachments_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'forum-attachments'
  AND (storage.foldername (name))[1] = auth.uid ()::text
);

CREATE POLICY "forum_attachments_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'forum-attachments'
  AND (storage.foldername (name))[1] = auth.uid ()::text
);

CREATE POLICY "forum_attachments_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'forum-attachments'
  AND (storage.foldername (name))[1] = auth.uid ()::text
);
