-- Güvenlik: M1 referral kampanya IDOR, M2 tıklama spam
-- supabase-referral-program-phase1.sql sonrasında çalıştırın.

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
  v_caller uuid := auth.uid();
BEGIN
  IF p_owner_user_id IS NULL OR p_campaign_type NOT IN ('influencer', 'mentor', 'student') THEN
    RAISE EXCEPTION 'invalid_campaign_request';
  END IF;

  IF v_caller IS NOT NULL
    AND NOT public.is_admin_user(v_caller)
    AND p_owner_user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'forbidden';
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
  v_recent_click timestamptz;
BEGIN
  IF char_length(v_session_id) < 8 THEN
    RAISE EXCEPTION 'invalid_session_id';
  END IF;

  v_campaign := public.resolve_referral_campaign(p_code);

  SELECT rc.clicked_at
  INTO v_recent_click
  FROM public.referral_clicks AS rc
  WHERE rc.campaign_id = v_campaign.id
    AND rc.session_id = v_session_id
    AND rc.clicked_at > now() - interval '10 minutes'
  ORDER BY rc.clicked_at DESC
  LIMIT 1;

  IF v_recent_click IS NOT NULL THEN
    INSERT INTO public.referral_session_last_click (session_id, campaign_id, code, clicked_at, updated_at)
    VALUES (v_session_id, v_campaign.id, v_campaign.code, v_recent_click, now())
    ON CONFLICT (session_id) DO UPDATE
    SET campaign_id = excluded.campaign_id,
        code = excluded.code,
        clicked_at = excluded.clicked_at,
        updated_at = now();

    RETURN jsonb_build_object(
      'campaign_id', v_campaign.id,
      'code', v_campaign.code,
      'campaign_type', v_campaign.campaign_type,
      'clicked_at', v_recent_click,
      'deduplicated', true
    );
  END IF;

  IF (
    SELECT count(*)
    FROM public.referral_clicks AS rc
    WHERE rc.session_id = v_session_id
      AND rc.clicked_at > now() - interval '1 hour'
  ) >= 60 THEN
    RAISE EXCEPTION 'referral_click_rate_limited';
  END IF;

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
    'clicked_at', now(),
    'deduplicated', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_referral_campaign (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_referral_campaign (uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_referral_click (text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_referral_click (text, text, text) TO anon, authenticated, service_role;
