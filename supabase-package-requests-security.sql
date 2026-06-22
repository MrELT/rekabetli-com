-- package_requests sunucu tarafı doğrulama
-- supabase-package-requests.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.package_requests
DROP CONSTRAINT IF EXISTS package_requests_package_id_format;

ALTER TABLE public.package_requests
ADD CONSTRAINT package_requests_package_id_format CHECK (
  char_length(package_id) BETWEEN 1 AND 64
  AND package_id ~ '^[a-zA-Z0-9_-]+$'
);

ALTER TABLE public.package_requests
DROP CONSTRAINT IF EXISTS package_requests_package_title_len;

ALTER TABLE public.package_requests
ADD CONSTRAINT package_requests_package_title_len CHECK (
  char_length(trim(package_title)) BETWEEN 1 AND 120
);

ALTER TABLE public.package_requests
DROP CONSTRAINT IF EXISTS package_requests_name_len;

ALTER TABLE public.package_requests
ADD CONSTRAINT package_requests_name_len CHECK (
  char_length(trim(first_name)) BETWEEN 1 AND 80
  AND char_length(trim(last_name)) BETWEEN 1 AND 80
);

ALTER TABLE public.package_requests
DROP CONSTRAINT IF EXISTS package_requests_email_len;

ALTER TABLE public.package_requests
ADD CONSTRAINT package_requests_email_len CHECK (
  char_length(trim(email)) BETWEEN 3 AND 120
);

ALTER TABLE public.package_requests
DROP CONSTRAINT IF EXISTS package_requests_note_len;

ALTER TABLE public.package_requests
ADD CONSTRAINT package_requests_note_len CHECK (
  note IS NULL OR char_length(note) <= 500
);

CREATE OR REPLACE FUNCTION public.validate_package_request_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mentor_packages jsonb;
  pkg_capacity integer;
  active_count integer;
BEGIN
  IF NEW.user_id = NEW.mentor_id THEN
    RAISE EXCEPTION 'package_request_self_not_allowed';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.mentor_id IS DISTINCT FROM OLD.mentor_id
       OR NEW.package_id IS DISTINCT FROM OLD.package_id THEN
      RAISE EXCEPTION 'package_request_immutable_fields';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = NEW.mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'package_request_invalid_mentor';
  END IF;

  SELECT COALESCE(mp.packages, '[]'::jsonb)
  INTO mentor_packages
  FROM public.mentor_pages AS mp
  WHERE mp.user_id = NEW.mentor_id;

  IF mentor_packages IS NULL THEN
    RAISE EXCEPTION 'package_request_mentor_page_missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(mentor_packages) AS pkg
    WHERE pkg->>'id' = NEW.package_id
  ) THEN
    RAISE EXCEPTION 'package_request_package_not_found';
  END IF;

  SELECT NULLIF(pkg->>'capacity', '')::integer
  INTO pkg_capacity
  FROM jsonb_array_elements(mentor_packages) AS pkg
  WHERE pkg->>'id' = NEW.package_id
  LIMIT 1;

  IF pkg_capacity IS NOT NULL AND pkg_capacity > 0 THEN
    SELECT COUNT(*)::integer
    INTO active_count
    FROM public.package_requests AS pr
    WHERE pr.mentor_id = NEW.mentor_id
      AND pr.package_id = NEW.package_id
      AND pr.status IN ('pending', 'reviewing', 'contacted')
      AND (TG_OP = 'INSERT' OR pr.id <> NEW.id);

    IF active_count >= pkg_capacity THEN
      RAISE EXCEPTION 'package_request_capacity_full';
    END IF;
  END IF;

  NEW.package_title := left(trim(NEW.package_title), 120);
  NEW.first_name := left(trim(NEW.first_name), 80);
  NEW.last_name := left(trim(NEW.last_name), 80);
  NEW.email := left(lower(trim(NEW.email)), 120);
  NEW.phone := NULLIF(left(trim(COALESCE(NEW.phone, '')), 20), '');
  NEW.note := NULLIF(left(trim(COALESCE(NEW.note, '')), 500), '');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS package_requests_validate_row ON public.package_requests;

CREATE TRIGGER package_requests_validate_row
BEFORE INSERT OR UPDATE ON public.package_requests
FOR EACH ROW
EXECUTE FUNCTION public.validate_package_request_row();
