-- Mentör vitrin müsaitlik durumu (Aktif / Meşgul)
-- supabase-mentor-pages.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS vitrin_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.mentor_pages.vitrin_active IS
  'Mentör vitrinini aktif tutar. false iken vitrinde Meşgul görünür ve paket ödemeleri/ön talepleri kabul edilmez.';

-- package_requests: meşgul mentöre talep engeli
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
  mentor_vitrin_active boolean;
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

  SELECT COALESCE(mp.packages, '[]'::jsonb), COALESCE(mp.vitrin_active, true)
  INTO mentor_packages, mentor_vitrin_active
  FROM public.mentor_pages AS mp
  WHERE mp.user_id = NEW.mentor_id;

  IF mentor_packages IS NULL THEN
    RAISE EXCEPTION 'package_request_mentor_page_missing';
  END IF;

  IF mentor_vitrin_active = false THEN
    RAISE EXCEPTION 'package_request_mentor_unavailable';
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
