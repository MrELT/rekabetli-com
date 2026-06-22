-- Paket kapasitesi: ön talep sayısına göre kalan kapasite (herkese açık okuma)
-- supabase-package-requests.sql sonrasında bir kez çalıştırın.

CREATE OR REPLACE FUNCTION public.get_mentor_package_fill_counts(p_mentor_id uuid)
RETURNS TABLE (package_id text, fill_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pr.package_id,
    COUNT(*)::integer AS fill_count
  FROM public.package_requests AS pr
  WHERE pr.mentor_id = p_mentor_id
    AND pr.status IN ('pending', 'reviewing', 'contacted')
  GROUP BY pr.package_id;
$$;

REVOKE ALL ON FUNCTION public.get_mentor_package_fill_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_package_fill_counts(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_mentor_package_fill_counts(uuid) IS
  'Mentör paketleri için aktif ön talep sayısını döner (kalan kapasite hesabı).';
