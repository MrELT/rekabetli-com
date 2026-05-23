-- Günlük görsel yükleme limiti (kullanıcı başına günde 5)
-- Supabase SQL Editor'da çalıştırın.

CREATE TABLE IF NOT EXISTS public.daily_image_uploads (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  upload_day date NOT NULL,
  upload_count integer NOT NULL DEFAULT 0 CHECK (upload_count >= 0),
  PRIMARY KEY (user_id, upload_day)
);

CREATE TABLE IF NOT EXISTS public.image_upload_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  bucket text NOT NULL,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS image_upload_log_user_created_idx
ON public.image_upload_log (user_id, created_at DESC);

ALTER TABLE public.daily_image_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_upload_log ENABLE ROW LEVEL SECURITY;

-- Yalnızca consume_daily_image_upload() fonksiyonu yazar (SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.consume_daily_image_upload(
  p_bucket text DEFAULT NULL,
  p_storage_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_day date := (timezone('Europe/Istanbul', now()))::date;
  v_max constant integer := 5;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.daily_image_uploads (user_id, upload_day, upload_count)
  VALUES (v_uid, v_day, 0)
  ON CONFLICT (user_id, upload_day) DO NOTHING;

  SELECT upload_count INTO v_count
  FROM public.daily_image_uploads
  WHERE user_id = v_uid AND upload_day = v_day
  FOR UPDATE;

  IF v_count >= v_max THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'used_count', v_count,
      'max_count', v_max,
      'remaining', 0
    );
  END IF;

  UPDATE public.daily_image_uploads
  SET upload_count = upload_count + 1
  WHERE user_id = v_uid AND upload_day = v_day;

  IF p_bucket IS NOT NULL AND length(trim(p_bucket)) > 0 THEN
    INSERT INTO public.image_upload_log (user_id, bucket, storage_path)
    VALUES (v_uid, trim(p_bucket), NULLIF(trim(p_storage_path), ''));
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'used_count', v_count + 1,
    'max_count', v_max,
    'remaining', v_max - v_count - 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_daily_image_upload (text, text) TO authenticated;
