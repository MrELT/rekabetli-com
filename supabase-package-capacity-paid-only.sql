-- Paket kapasitesi yalnızca gerçekleşen satışlarda düşsün.
-- Stripe checkout'ta vazgeçilen pending siparişler kapasiteyi rezerve etmez.
-- supabase-package-orders.sql sonrasında bir kez çalıştırın.

CREATE OR REPLACE FUNCTION public.count_package_capacity_usage (
  p_mentor_id uuid,
  p_package_id text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(src.cnt), 0)::integer
  FROM (
    SELECT COUNT(*)::integer AS cnt
    FROM public.package_requests AS pr
    WHERE pr.mentor_id = p_mentor_id
      AND pr.package_id = p_package_id
      AND pr.status IN ('pending', 'reviewing', 'contacted')

    UNION ALL

    SELECT COUNT(*)::integer AS cnt
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
      AND mps.package_id = p_package_id
  ) AS src;
$$;

REVOKE ALL ON FUNCTION public.count_package_capacity_usage (uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_mentor_package_fill_counts (p_mentor_id uuid)
RETURNS TABLE (package_id text, fill_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    combined.package_id,
    SUM(combined.cnt)::integer AS fill_count
  FROM (
    SELECT
      pr.package_id,
      COUNT(*)::integer AS cnt
    FROM public.package_requests AS pr
    WHERE pr.mentor_id = p_mentor_id
      AND pr.status IN ('pending', 'reviewing', 'contacted')
    GROUP BY pr.package_id

    UNION ALL

    SELECT
      mps.package_id,
      COUNT(*)::integer AS cnt
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
    GROUP BY mps.package_id
  ) AS combined
  GROUP BY combined.package_id;
$$;

REVOKE ALL ON FUNCTION public.get_mentor_package_fill_counts (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_package_fill_counts (uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.count_package_capacity_usage (uuid, text) IS
  'Paket kapasite kullanımı: kayıtlı öğrenciler + aktif ön talepler (pending checkout hariç).';

COMMENT ON FUNCTION public.get_mentor_package_fill_counts (uuid) IS
  'Mentör paketleri için doluluk sayısı (yalnızca kayıtlı öğrenciler + aktif ön talepler).';
