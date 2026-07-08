-- Panel hata bildirimleri (mentör, danışman, influencer)

CREATE TABLE IF NOT EXISTS public.panel_error_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  panel_role text NOT NULL,
  error_code text,
  description text NOT NULL,
  page_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT panel_error_reports_role_check
    CHECK (panel_role IN ('mentor', 'student', 'influencer')),
  CONSTRAINT panel_error_reports_description_len
    CHECK (char_length(trim(description)) BETWEEN 10 AND 2000),
  CONSTRAINT panel_error_reports_error_code_len
    CHECK (error_code IS NULL OR char_length(trim(error_code)) <= 120)
);

CREATE INDEX IF NOT EXISTS panel_error_reports_created_idx
ON public.panel_error_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS panel_error_reports_user_created_idx
ON public.panel_error_reports (user_id, created_at DESC);

COMMENT ON TABLE public.panel_error_reports IS
  'Mentör, danışman ve influencer panellerinden gönderilen hata bildirimleri.';

ALTER TABLE public.panel_error_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "panel_error_reports_insert_self" ON public.panel_error_reports;
CREATE POLICY "panel_error_reports_insert_self"
ON public.panel_error_reports
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "panel_error_reports_select_self" ON public.panel_error_reports;
CREATE POLICY "panel_error_reports_select_self"
ON public.panel_error_reports
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.is_admin_user(auth.uid()));

CREATE OR REPLACE FUNCTION public.submit_panel_error_report (
  p_panel_role text,
  p_error_code text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_page_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text := lower(btrim(coalesce(p_panel_role, '')));
  v_code text := NULLIF(left(btrim(coalesce(p_error_code, '')), 120), '');
  v_description text := btrim(coalesce(p_description, ''));
  v_page_url text := NULLIF(left(btrim(coalesce(p_page_url, '')), 500), '');
  v_report_id uuid;
  v_recent_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF v_role NOT IN ('mentor', 'student', 'influencer') THEN
    RAISE EXCEPTION 'panel_error_invalid_role';
  END IF;

  IF char_length(v_description) < 10 THEN
    RAISE EXCEPTION 'panel_error_description_too_short';
  END IF;

  IF char_length(v_description) > 2000 THEN
    RAISE EXCEPTION 'panel_error_description_too_long';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_recent_count
  FROM public.panel_error_reports AS per
  WHERE per.user_id = v_user_id
    AND per.created_at >= now() - interval '1 hour';

  IF v_recent_count >= 10 THEN
    RAISE EXCEPTION 'panel_error_rate_limited';
  END IF;

  INSERT INTO public.panel_error_reports (
    user_id,
    panel_role,
    error_code,
    description,
    page_url
  )
  VALUES (
    v_user_id,
    v_role,
    v_code,
    v_description,
    v_page_url
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_panel_error_report (text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_panel_error_report (text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_panel_error_reports ()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  reporter_name text,
  reporter_email text,
  panel_role text,
  error_code text,
  description text,
  page_url text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  RETURN QUERY
  SELECT
    per.id,
    per.user_id,
    coalesce(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(p.email), ''),
      'Kullanıcı'
    ) AS reporter_name,
    coalesce(NULLIF(btrim(p.email), ''), '—') AS reporter_email,
    per.panel_role,
    per.error_code,
    per.description,
    per.page_url,
    per.created_at
  FROM public.panel_error_reports AS per
  LEFT JOIN public.profiles AS p ON p.id = per.user_id
  ORDER BY per.created_at DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_panel_error_reports () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_panel_error_reports () TO authenticated;
