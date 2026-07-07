-- Davet komisyonu özet istatistikleri (mentör cüzdan paneli)
-- supabase-referral-program-phase3-mentor-commission.sql sonrasında çalıştırın.
-- İade/iptal düşümü: supabase-referral-affiliate-cancel-deduction.sql

CREATE OR REPLACE FUNCTION public.get_my_mentor_referral_commission_stats ()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
  v_campaign_id uuid;
  v_signup_count integer := 0;
  v_own_buyer_count integer := 0;
  v_other_buyer_count integer := 0;
  v_purchasing_user_count integer := 0;
  v_own_audience_earnings numeric := 0;
  v_affiliate_earnings numeric := 0;
BEGIN
  IF v_mentor_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = v_mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'mentor_required';
  END IF;

  SELECT rc.id
  INTO v_campaign_id
  FROM public.referral_campaigns AS rc
  WHERE rc.owner_user_id = v_mentor_id
    AND rc.campaign_type = 'mentor'
  LIMIT 1;

  IF v_campaign_id IS NOT NULL THEN
    SELECT count(*)::integer
    INTO v_signup_count
    FROM public.user_referral_attribution AS ura
    WHERE ura.campaign_id = v_campaign_id;
  END IF;

  SELECT count(DISTINCT po.user_id)::integer
  INTO v_own_buyer_count
  FROM public.package_orders AS po
  INNER JOIN public.user_referral_attribution AS ura
    ON ura.user_id = po.user_id
  WHERE ura.referrer_user_id = v_mentor_id
    AND ura.referrer_type = 'mentor'
    AND public.package_order_counts_for_referral_stats(po)
    AND po.mentor_id = v_mentor_id;

  SELECT count(DISTINCT po.user_id)::integer
  INTO v_other_buyer_count
  FROM public.package_orders AS po
  INNER JOIN public.user_referral_attribution AS ura
    ON ura.user_id = po.user_id
  WHERE ura.referrer_user_id = v_mentor_id
    AND ura.referrer_type = 'mentor'
    AND public.package_order_counts_for_referral_stats(po)
    AND po.mentor_id <> v_mentor_id;

  SELECT count(DISTINCT po.user_id)::integer
  INTO v_purchasing_user_count
  FROM public.package_orders AS po
  INNER JOIN public.user_referral_attribution AS ura
    ON ura.user_id = po.user_id
  WHERE ura.referrer_user_id = v_mentor_id
    AND ura.referrer_type = 'mentor'
    AND public.package_order_counts_for_referral_stats(po);

  SELECT coalesce(
    sum(
      round(
        coalesce(po.amount_paid, po.list_price) * public.referral_commission_rate(),
        2
      )
    ),
    0
  )
  INTO v_own_audience_earnings
  FROM public.package_orders AS po
  WHERE public.package_order_counts_for_referral_stats(po)
    AND po.referral_commission_type = 'mentor_own_audience'
    AND po.mentor_id = v_mentor_id;

  SELECT coalesce(sum(mwl.net_amount), 0)
  INTO v_affiliate_earnings
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.mentor_id = v_mentor_id
    AND mwl.entry_type IN ('referral_bonus', 'referral_bonus_refund');

  RETURN jsonb_build_object(
    'signup_count', v_signup_count,
    'own_package_buyer_count', v_own_buyer_count,
    'other_mentor_buyer_count', v_other_buyer_count,
    'purchasing_user_count', v_purchasing_user_count,
    'own_audience_earnings', round(v_own_audience_earnings, 2),
    'affiliate_earnings', round(v_affiliate_earnings, 2),
    'total_earnings', round(v_own_audience_earnings + v_affiliate_earnings, 2),
    'commission_rate_pct', round(public.referral_commission_rate() * 100, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_mentor_referral_commission_stats () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_mentor_referral_commission_stats () TO authenticated;

COMMENT ON FUNCTION public.get_my_mentor_referral_commission_stats () IS
  'Mentör davet linki: kayıt, alışveriş yapan kullanıcı ve komisyon kazanç özeti.';
