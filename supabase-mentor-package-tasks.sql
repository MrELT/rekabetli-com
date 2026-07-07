-- Mentör paket görev paketleri (başlık, açıklama, ekler, son tarih veya zaman aralığı)
-- supabase-mentor-package-enrollments.sql sonrasında bir kez çalıştırın.

CREATE TABLE IF NOT EXISTS public.mentor_package_task_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  package_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  schedule_kind text NOT NULL DEFAULT 'deadline',
  deadline_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_package_task_packs_schedule_kind_check CHECK (
    schedule_kind IN ('deadline', 'range')
  ),
  CONSTRAINT mentor_package_task_packs_package_id_format CHECK (
    char_length(package_id) BETWEEN 1 AND 64
    AND package_id ~ '^[a-zA-Z0-9_-]+$'
  ),
  CONSTRAINT mentor_package_task_packs_title_not_empty CHECK (
    char_length(btrim(title)) BETWEEN 1 AND 160
  ),
  CONSTRAINT mentor_package_task_packs_description_len CHECK (
    char_length(description) <= 8000
  ),
  CONSTRAINT mentor_package_task_packs_deadline_required CHECK (
    schedule_kind <> 'deadline' OR deadline_at IS NOT NULL
  ),
  CONSTRAINT mentor_package_task_packs_range_required CHECK (
    schedule_kind <> 'range'
    OR (
      starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND ends_at >= starts_at
    )
  )
);

CREATE INDEX IF NOT EXISTS mentor_package_task_packs_mentor_package_idx
ON public.mentor_package_task_packs (mentor_id, package_id, created_at DESC);

ALTER TABLE public.mentor_package_task_packs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_package_task_packs_select_mentor" ON public.mentor_package_task_packs;

CREATE POLICY "mentor_package_task_packs_select_mentor"
ON public.mentor_package_task_packs
FOR SELECT
TO authenticated
USING (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
);

DROP POLICY IF EXISTS "mentor_package_task_packs_insert_mentor" ON public.mentor_package_task_packs;

CREATE POLICY "mentor_package_task_packs_insert_mentor"
ON public.mentor_package_task_packs
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
);

DROP POLICY IF EXISTS "mentor_package_task_packs_update_mentor" ON public.mentor_package_task_packs;

CREATE POLICY "mentor_package_task_packs_update_mentor"
ON public.mentor_package_task_packs
FOR UPDATE
TO authenticated
USING (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
)
WITH CHECK (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
);

DROP POLICY IF EXISTS "mentor_package_task_packs_delete_mentor" ON public.mentor_package_task_packs;

CREATE POLICY "mentor_package_task_packs_delete_mentor"
ON public.mentor_package_task_packs
FOR DELETE
TO authenticated
USING (
  auth.uid () = mentor_id
  AND public.mentor_owns_package_id (mentor_id, package_id)
);

DROP POLICY IF EXISTS "mentor_package_task_packs_select_admin" ON public.mentor_package_task_packs;

CREATE POLICY "mentor_package_task_packs_select_admin"
ON public.mentor_package_task_packs
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

CREATE OR REPLACE FUNCTION public.touch_mentor_package_task_pack_updated_at ()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mentor_package_task_packs_updated_at ON public.mentor_package_task_packs;

CREATE TRIGGER mentor_package_task_packs_updated_at
BEFORE UPDATE ON public.mentor_package_task_packs
FOR EACH ROW
EXECUTE FUNCTION public.touch_mentor_package_task_pack_updated_at ();

-- Ek dosyalar: mentor-task-attachments bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('mentor-task-attachments', 'mentor-task-attachments', true, 10485760)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "mentor_task_attachments_public_read" ON storage.objects;
DROP POLICY IF EXISTS "mentor_task_attachments_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "mentor_task_attachments_update_own" ON storage.objects;
DROP POLICY IF EXISTS "mentor_task_attachments_delete_own" ON storage.objects;

CREATE POLICY "mentor_task_attachments_public_read"
ON storage.objects
FOR SELECT
TO authenticated, anon
USING (bucket_id = 'mentor-task-attachments');

CREATE POLICY "mentor_task_attachments_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'mentor-task-attachments'
  AND (storage.foldername (name))[1] = auth.uid ()::text
);

CREATE POLICY "mentor_task_attachments_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'mentor-task-attachments'
  AND (storage.foldername (name))[1] = auth.uid ()::text
);

CREATE POLICY "mentor_task_attachments_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'mentor-task-attachments'
  AND (storage.foldername (name))[1] = auth.uid ()::text
);
