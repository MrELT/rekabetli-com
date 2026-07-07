-- Referral / Influencer programı — Faz 1: attribution çekirdeği
-- supabase-user-code-mentor-students.sql ve supabase-admin-panel.sql sonrasında çalıştırın.

CREATE OR REPLACE FUNCTION public.referral_click_window_days ()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 30;
$$;

CREATE OR REPLACE FUNCTION public.referral_commission_years ()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 1;
$$;

CREATE OR REPLACE FUNCTION public.referral_commission_rate ()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 0.05::numeric;
$$;

CREATE OR REPLACE FUNCTION public.normalize_referral_code (p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(btrim(coalesce(p_code, '')), '\s+', '', 'g'));
$$;

CREATE TABLE IF NOT EXISTS public.influencer_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  display_label text NOT NULL DEFAULT '',
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT influencer_profiles_status_check CHECK (
    status IN ('pending', 'approved', 'rejected')
  )
);

CREATE TABLE IF NOT EXISTS public.referral_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  campaign_type text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  mentor_scope_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_campaigns_code_format CHECK (
    char_length(code) BETWEEN 4 AND 32
    AND code ~ '^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$|^[A-Z0-9]{4}$'
  ),
  CONSTRAINT referral_campaigns_type_check CHECK (
    campaign_type IN ('influencer', 'mentor', 'student')
  ),
  CONSTRAINT referral_campaigns_code_uidx UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS referral_campaigns_owner_idx
ON public.referral_campaigns (owner_user_id, campaign_type);

CREATE UNIQUE INDEX IF NOT EXISTS referral_campaigns_owner_type_uidx
ON public.referral_campaigns (owner_user_id, campaign_type);

CREATE TABLE IF NOT EXISTS public.referral_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.referral_campaigns (id) ON DELETE CASCADE,
  session_id text NOT NULL,
  landing_path text NOT NULL DEFAULT '',
  clicked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_clicks_session_len CHECK (char_length(session_id) BETWEEN 8 AND 128)
);

CREATE INDEX IF NOT EXISTS referral_clicks_campaign_clicked_idx
ON public.referral_clicks (campaign_id, clicked_at DESC);

CREATE TABLE IF NOT EXISTS public.referral_session_last_click (
  session_id text PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.referral_campaigns (id) ON DELETE CASCADE,
  code text NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_session_last_click_session_len CHECK (char_length(session_id) BETWEEN 8 AND 128)
);

CREATE TABLE IF NOT EXISTS public.user_referral_attribution (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.referral_campaigns (id) ON DELETE RESTRICT,
  referrer_user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  referrer_type text NOT NULL,
  session_id text NOT NULL DEFAULT '',
  attributed_at timestamptz NOT NULL DEFAULT now(),
  commission_until timestamptz NOT NULL,
  CONSTRAINT user_referral_attribution_type_check CHECK (
    referrer_type IN ('influencer', 'mentor', 'student')
  )
);

CREATE INDEX IF NOT EXISTS user_referral_attribution_referrer_idx
ON public.user_referral_attribution (referrer_user_id, attributed_at DESC);

CREATE INDEX IF NOT EXISTS user_referral_attribution_campaign_idx
ON public.user_referral_attribution (campaign_id, attributed_at DESC);

ALTER TABLE public.influencer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_session_last_click ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_referral_attribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "influencer_profiles_select_own" ON public.influencer_profiles;
CREATE POLICY "influencer_profiles_select_own"
ON public.influencer_profiles
FOR SELECT
TO authenticated
USING (auth.uid () = user_id OR public.is_admin_user (auth.uid ()));

DROP POLICY IF EXISTS "referral_campaigns_select_own" ON public.referral_campaigns;
CREATE POLICY "referral_campaigns_select_own"
ON public.referral_campaigns
FOR SELECT
TO authenticated
USING (auth.uid () = owner_user_id OR public.is_admin_user (auth.uid ()));

DROP POLICY IF EXISTS "user_referral_attribution_select_own" ON public.user_referral_attribution;
CREATE POLICY "user_referral_attribution_select_own"
ON public.user_referral_attribution
FOR SELECT
TO authenticated
USING (
  auth.uid () = user_id
  OR auth.uid () = referrer_user_id
  OR public.is_admin_user (auth.uid ())
);

CREATE OR REPLACE FUNCTION public.referral_code_suffix_from_user_code (p_user_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(
    coalesce(
      nullif(regexp_replace(btrim(coalesce(p_user_code, '')), '^RKL-', '', 'i'), ''),
      substr(md5(coalesce(nullif(btrim(p_user_code), ''), 'user')), 1, 6)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.build_default_referral_code (
  p_campaign_type text,
  p_user_code text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_suffix text := public.referral_code_suffix_from_user_code(p_user_code);
BEGIN
  IF p_campaign_type = 'mentor' THEN
    RETURN 'M-' || v_suffix;
  ELSIF p_campaign_type = 'student' THEN
    RETURN 'S-' || v_suffix;
  ELSIF p_campaign_type = 'influencer' THEN
    RETURN 'INF-' || v_suffix;
  END IF;
  RAISE EXCEPTION 'invalid_campaign_type';
END;
$$;

CREATE OR REPLACE FUNCTION public.is_referral_campaign_usable (p_campaign public.referral_campaigns)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT coalesce(p_campaign.is_active, false) THEN
    RETURN false;
  END IF;

  IF p_campaign.campaign_type = 'influencer' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.influencer_profiles AS ip
      WHERE ip.user_id = p_campaign.owner_user_id
        AND ip.status = 'approved'
    );
  END IF;

  IF p_campaign.campaign_type = 'mentor' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = p_campaign.owner_user_id
        AND p.is_mentor = true
    );
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_referral_campaign (
  p_owner_user_id uuid,
  p_campaign_type text
)
RETURNS public.referral_campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_campaign public.referral_campaigns%ROWTYPE;
  v_code text;
  v_tries integer := 0;
BEGIN
  IF p_owner_user_id IS NULL OR p_campaign_type NOT IN ('influencer', 'mentor', 'student') THEN
    RAISE EXCEPTION 'invalid_campaign_request';
  END IF;

  SELECT *
  INTO v_campaign
  FROM public.referral_campaigns AS rc
  WHERE rc.owner_user_id = p_owner_user_id
    AND rc.campaign_type = p_campaign_type
  LIMIT 1;

  IF FOUND THEN
    RETURN v_campaign;
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles AS p
  WHERE p.id = p_owner_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF p_campaign_type = 'mentor' AND NOT coalesce(v_profile.is_mentor, false) THEN
    RAISE EXCEPTION 'mentor_required';
  END IF;

  IF p_campaign_type = 'influencer' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.influencer_profiles AS ip
      WHERE ip.user_id = p_owner_user_id
        AND ip.status = 'approved'
    ) THEN
      RAISE EXCEPTION 'influencer_not_approved';
    END IF;
  END IF;

  v_code := public.build_default_referral_code(p_campaign_type, v_profile.user_code);

  LOOP
    BEGIN
      INSERT INTO public.referral_campaigns (
        code,
        campaign_type,
        owner_user_id,
        mentor_scope_id
      )
      VALUES (
        v_code,
        p_campaign_type,
        p_owner_user_id,
        CASE WHEN p_campaign_type = 'mentor' THEN p_owner_user_id ELSE NULL END
      )
      RETURNING * INTO v_campaign;

      RETURN v_campaign;
    EXCEPTION
      WHEN unique_violation THEN
        v_tries := v_tries + 1;
        IF v_tries > 8 THEN
          RAISE EXCEPTION 'referral_code_generation_failed';
        END IF;
        v_code := left(v_code, 24) || '-' || substr(md5(random()::text), 1, 4);
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_referral_campaign (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_referral_campaign (uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_referral_campaign (p_code text)
RETURNS public.referral_campaigns
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := public.normalize_referral_code(p_code);
  v_campaign public.referral_campaigns%ROWTYPE;
BEGIN
  IF v_code = '' THEN
    RAISE EXCEPTION 'invalid_referral_code';
  END IF;

  SELECT *
  INTO v_campaign
  FROM public.referral_campaigns AS rc
  WHERE rc.code = v_code
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral_code_not_found';
  END IF;

  IF NOT public.is_referral_campaign_usable(v_campaign) THEN
    RAISE EXCEPTION 'referral_code_inactive';
  END IF;

  RETURN v_campaign;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_referral_campaign (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_referral_campaign (text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_referral_click (
  p_code text,
  p_session_id text,
  p_landing_path text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.referral_campaigns%ROWTYPE;
  v_session_id text := left(btrim(coalesce(p_session_id, '')), 128);
  v_landing_path text := left(btrim(coalesce(p_landing_path, '')), 500);
BEGIN
  IF char_length(v_session_id) < 8 THEN
    RAISE EXCEPTION 'invalid_session_id';
  END IF;

  v_campaign := public.resolve_referral_campaign(p_code);

  INSERT INTO public.referral_clicks (campaign_id, session_id, landing_path)
  VALUES (v_campaign.id, v_session_id, v_landing_path);

  INSERT INTO public.referral_session_last_click (session_id, campaign_id, code, clicked_at, updated_at)
  VALUES (v_session_id, v_campaign.id, v_campaign.code, now(), now())
  ON CONFLICT (session_id) DO UPDATE
  SET campaign_id = excluded.campaign_id,
      code = excluded.code,
      clicked_at = excluded.clicked_at,
      updated_at = now();

  RETURN jsonb_build_object(
    'campaign_id', v_campaign.id,
    'code', v_campaign.code,
    'campaign_type', v_campaign.campaign_type,
    'clicked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_referral_click (text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_referral_click (text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_referral_attribution (
  p_code text DEFAULT NULL,
  p_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing public.user_referral_attribution%ROWTYPE;
  v_campaign public.referral_campaigns%ROWTYPE;
  v_session_id text := left(btrim(coalesce(p_session_id, '')), 128);
  v_code text := public.normalize_referral_code(p_code);
  v_session_click public.referral_session_last_click%ROWTYPE;
  v_click_cutoff timestamptz := now() - (public.referral_click_window_days() || ' days')::interval;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.user_referral_attribution AS ura
  WHERE ura.user_id = v_user_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'user_id', v_user_id,
      'already_attributed', true,
      'referrer_type', v_existing.referrer_type,
      'attributed_at', v_existing.attributed_at,
      'commission_until', v_existing.commission_until
    );
  END IF;

  IF v_code = '' AND char_length(v_session_id) >= 8 THEN
    SELECT *
    INTO v_session_click
    FROM public.referral_session_last_click AS rsl
    WHERE rsl.session_id = v_session_id
      AND rsl.clicked_at >= v_click_cutoff
    LIMIT 1;

    IF FOUND THEN
      v_code := v_session_click.code;
    END IF;
  ELSIF v_code <> '' AND char_length(v_session_id) >= 8 THEN
    SELECT *
    INTO v_session_click
    FROM public.referral_session_last_click AS rsl
    WHERE rsl.session_id = v_session_id
    LIMIT 1;

    IF FOUND AND v_session_click.clicked_at >= v_click_cutoff THEN
      v_code := v_session_click.code;
    END IF;
  END IF;

  IF v_code = '' THEN
    RETURN jsonb_build_object('user_id', v_user_id, 'attributed', false, 'reason', 'no_valid_click');
  END IF;

  v_campaign := public.resolve_referral_campaign(v_code);

  IF v_campaign.owner_user_id = v_user_id THEN
    RAISE EXCEPTION 'referral_self_not_allowed';
  END IF;

  INSERT INTO public.user_referral_attribution (
    user_id,
    campaign_id,
    referrer_user_id,
    referrer_type,
    session_id,
    attributed_at,
    commission_until
  )
  VALUES (
    v_user_id,
    v_campaign.id,
    v_campaign.owner_user_id,
    v_campaign.campaign_type,
    coalesce(v_session_id, ''),
    now(),
    now() + make_interval(years => public.referral_commission_years())
  );

  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'attributed', true,
    'campaign_id', v_campaign.id,
    'code', v_campaign.code,
    'referrer_type', v_campaign.campaign_type,
    'attributed_at', now(),
    'commission_until', now() + make_interval(years => public.referral_commission_years())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_referral_attribution (text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_referral_attribution (text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_referral_program ()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_campaign public.referral_campaigns%ROWTYPE;
  v_influencer_status text;
  v_signup_count integer := 0;
  v_click_count integer := 0;
  v_campaign_type text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles AS p
  WHERE p.id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  SELECT ip.status
  INTO v_influencer_status
  FROM public.influencer_profiles AS ip
  WHERE ip.user_id = v_user_id;

  IF coalesce(v_profile.is_mentor, false) THEN
    v_campaign_type := 'mentor';
  ELSE
    v_campaign_type := 'student';
  END IF;

  v_campaign := public.ensure_referral_campaign(v_user_id, v_campaign_type);

  SELECT count(*)::integer
  INTO v_signup_count
  FROM public.user_referral_attribution AS ura
  WHERE ura.campaign_id = v_campaign.id;

  SELECT count(*)::integer
  INTO v_click_count
  FROM public.referral_clicks AS rc
  WHERE rc.campaign_id = v_campaign.id;

  RETURN jsonb_build_object(
    'campaign_type', v_campaign_type,
    'code', v_campaign.code,
    'link_path', '/r/' || v_campaign.code,
    'signup_count', v_signup_count,
    'click_count', v_click_count,
    'commission_rate', public.referral_commission_rate(),
    'commission_years', public.referral_commission_years(),
    'click_window_days', public.referral_click_window_days(),
    'influencer_status', coalesce(v_influencer_status, 'none'),
    'influencer_eligible', v_influencer_status = 'approved'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_referral_program () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_referral_program () TO authenticated;

CREATE OR REPLACE FUNCTION public.get_influencer_referral_program ()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_campaign public.referral_campaigns%ROWTYPE;
  v_signup_count integer := 0;
  v_click_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.influencer_profiles AS ip
    WHERE ip.user_id = v_user_id
      AND ip.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'influencer_not_approved';
  END IF;

  v_campaign := public.ensure_referral_campaign(v_user_id, 'influencer');

  SELECT count(*)::integer
  INTO v_signup_count
  FROM public.user_referral_attribution AS ura
  WHERE ura.campaign_id = v_campaign.id;

  SELECT count(*)::integer
  INTO v_click_count
  FROM public.referral_clicks AS rc
  WHERE rc.campaign_id = v_campaign.id;

  RETURN jsonb_build_object(
    'campaign_type', 'influencer',
    'code', v_campaign.code,
    'link_path', '/r/' || v_campaign.code,
    'signup_count', v_signup_count,
    'click_count', v_click_count,
    'commission_rate', public.referral_commission_rate(),
    'commission_years', public.referral_commission_years(),
    'click_window_days', public.referral_click_window_days()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_influencer_referral_program () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_influencer_referral_program () TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_influencer_applications ()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  RETURN coalesce(
    (
      SELECT jsonb_agg(row_to_json(q)::jsonb ORDER BY q.created_at DESC)
      FROM (
        SELECT
          ip.user_id,
          ip.status,
          ip.display_label,
          ip.approved_at,
          ip.created_at,
          coalesce(nullif(btrim(p.display_name), ''), 'Kullanıcı') AS display_name,
          rc.code AS referral_code
        FROM public.influencer_profiles AS ip
        JOIN public.profiles AS p ON p.id = ip.user_id
        LEFT JOIN public.referral_campaigns AS rc
          ON rc.owner_user_id = ip.user_id
          AND rc.campaign_type = 'influencer'
        ORDER BY ip.created_at DESC
        LIMIT 200
      ) AS q
    ),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_influencer_applications () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_influencer_applications () TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_influencer_status (
  p_user_id uuid,
  p_status text,
  p_display_label text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_campaign public.referral_campaigns%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF p_user_id IS NULL OR v_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  INSERT INTO public.influencer_profiles (user_id, status, display_label, approved_at, approved_by)
  VALUES (
    p_user_id,
    v_status,
    left(btrim(coalesce(p_display_label, '')), 120),
    CASE WHEN v_status = 'approved' THEN now() ELSE NULL END,
    CASE WHEN v_status = 'approved' THEN auth.uid() ELSE NULL END
  )
  ON CONFLICT (user_id) DO UPDATE
  SET status = excluded.status,
      display_label = CASE
        WHEN excluded.display_label <> '' THEN excluded.display_label
        ELSE public.influencer_profiles.display_label
      END,
      approved_at = CASE WHEN excluded.status = 'approved' THEN now() ELSE NULL END,
      approved_by = CASE WHEN v_status = 'approved' THEN auth.uid() ELSE NULL END,
      updated_at = now();

  IF v_status = 'approved' THEN
    v_campaign := public.ensure_referral_campaign(p_user_id, 'influencer');
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'status', v_status,
    'referral_code', v_campaign.code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_influencer_status (uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_influencer_status (uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_influencer_application (
  p_user_id uuid,
  p_display_label text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  RETURN public.admin_set_influencer_status(p_user_id, 'pending', p_display_label);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_influencer_application (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_influencer_application (uuid, text) TO authenticated;

COMMENT ON TABLE public.user_referral_attribution IS
  'Kayıt anında tek referrer (son tıklama, 30 gün). Komisyon penceresi kayıttan itibaren 1 yıl.';

