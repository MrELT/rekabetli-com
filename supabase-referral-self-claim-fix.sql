-- Kendi referans kodunu kullanma durumu artık hata değil, yapılandırılmış cevap
-- Önce: RAISE EXCEPTION 'referral_self_not_allowed' → PostgREST HTTP 400
-- Sonra: 200 + { attributed: false, reason: 'self_referral' }
-- Böylece 'no_valid_click' ile tutarlı davranır ve istemci her oturumda 400 almaz.
-- Gerçek hatalar (referral_code_not_found / referral_code_inactive / auth_required)
-- bilinçli olarak exception kalır; teşhis edilebilirlik korunur.
-- Önkoşul: supabase-referral-program-phase1.sql
-- Supabase Dashboard → SQL Editor → bu dosyanın tamamını çalıştırın.

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

  -- Kendi kodunu kullanmak bir iş kuralı ihlali; hata değil, sonuçtur.
  IF v_campaign.owner_user_id = v_user_id THEN
    RETURN jsonb_build_object(
      'user_id', v_user_id,
      'attributed', false,
      'reason', 'self_referral',
      'code', v_campaign.code
    );
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

COMMENT ON FUNCTION public.claim_referral_attribution (text, text) IS
  'Referans atfını bağlar. Kendi kodu kullanıldığında hata atmaz, reason=self_referral döner.';
