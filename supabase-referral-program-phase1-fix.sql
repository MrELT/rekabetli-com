-- Referral link düzeltmesi: get_my_referral_program STABLE iken INSERT yapılamıyordu.
-- supabase-referral-program-phase1.sql sonrasında çalıştırın.

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

-- Mevcut mentör ve öğrenciler için kampanya oluştur
DO $$
DECLARE
  v_row record;
  v_campaign public.referral_campaigns%ROWTYPE;
BEGIN
  FOR v_row IN
    SELECT p.id, p.is_mentor
    FROM public.profiles AS p
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.referral_campaigns AS rc
      WHERE rc.owner_user_id = p.id
        AND rc.campaign_type = CASE WHEN coalesce(p.is_mentor, false) THEN 'mentor' ELSE 'student' END
    )
  LOOP
    BEGIN
      v_campaign := public.ensure_referral_campaign(
        v_row.id,
        CASE WHEN coalesce(v_row.is_mentor, false) THEN 'mentor' ELSE 'student' END
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'referral backfill skipped %: %', v_row.id, SQLERRM;
    END;
  END LOOP;
END;
$$;
