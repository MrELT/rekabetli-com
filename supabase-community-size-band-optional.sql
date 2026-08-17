-- Topluluk kapasite aralığı (0-10, 10-50, …) artık kullanılmıyor.
-- Kolon kalır; yeni kayıtlarda boş olabilir.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint AS c
    JOIN pg_class AS t ON t.oid = c.conrelid
    JOIN pg_namespace AS n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'communities'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%size_band%'
  LOOP
    EXECUTE format('ALTER TABLE public.communities DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END
$$;

ALTER TABLE public.communities
  ALTER COLUMN size_band DROP NOT NULL;

ALTER TABLE public.communities
  DROP CONSTRAINT IF EXISTS communities_size_band_check;

ALTER TABLE public.communities
  ADD CONSTRAINT communities_size_band_check
  CHECK (
    size_band IS NULL
    OR size_band IN ('0-10', '10-50', '50-100', '100+')
  );
