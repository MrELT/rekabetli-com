-- Güvenlik: eşzamanlı ödeme taleplerinin bakiyeyi aşmasını engeller (C1).
-- supabase-mentor-payout-wise-dynamic-fee.sql ve supabase-influencer-program-full.sql sonrasında çalıştırın.

-- Kullanıcı başına tek aktif (pending/processing) talep
CREATE UNIQUE INDEX IF NOT EXISTS mentor_payout_requests_one_active_per_mentor_idx
ON public.mentor_payout_requests (mentor_id)
WHERE status IN ('pending', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS influencer_payout_requests_one_active_per_influencer_idx
ON public.influencer_payout_requests (influencer_id)
WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION public.request_mentor_payout (
  p_amount numeric DEFAULT NULL,
  p_self_billing_agreed boolean DEFAULT false,
  p_transfer_fee numeric DEFAULT NULL,
  p_wise_quote_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
  v_available numeric;
  v_amount numeric;
  v_transfer_fee numeric;
  v_amount_net numeric;
  v_request_id uuid;
  v_quote_id text := nullif(btrim(coalesce(p_wise_quote_id, '')), '');
BEGIN
  IF v_mentor_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT coalesce(p_self_billing_agreed, false) THEN
    RAISE EXCEPTION 'self_billing_agreement_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = v_mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'mentor_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_payout_accounts AS mpa
    WHERE mpa.user_id = v_mentor_id
  ) THEN
    RAISE EXCEPTION 'payout_account_required';
  END IF;

  IF p_transfer_fee IS NULL OR p_transfer_fee < 0 THEN
    RAISE EXCEPTION 'transfer_fee_required';
  END IF;

  v_transfer_fee := round(p_transfer_fee, 2);

  -- Serialize payout requests per mentor within this transaction
  PERFORM pg_advisory_xact_lock(hashtext('mentor_payout:' || v_mentor_id::text));

  IF EXISTS (
    SELECT 1
    FROM public.mentor_payout_requests AS mpr
    WHERE mpr.mentor_id = v_mentor_id
      AND mpr.status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'payout_request_already_active';
  END IF;

  v_available := public.get_mentor_wallet_available_balance(v_mentor_id);
  v_amount := round(coalesce(p_amount, v_available), 2);

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'payout_amount_invalid';
  END IF;

  IF v_amount > v_available THEN
    RAISE EXCEPTION 'payout_insufficient_balance';
  END IF;

  IF v_transfer_fee > greatest(v_amount * 0.15, 2500) THEN
    RAISE EXCEPTION 'transfer_fee_invalid';
  END IF;

  v_amount_net := round(v_amount - v_transfer_fee, 2);

  IF v_amount_net <= 0 THEN
    RAISE EXCEPTION 'payout_amount_too_low_after_fee';
  END IF;

  INSERT INTO public.mentor_payout_requests (
    mentor_id,
    amount_requested,
    transfer_fee,
    amount_net,
    status,
    self_billing_agreed_at,
    wise_quote_id
  )
  VALUES (
    v_mentor_id,
    v_amount,
    v_transfer_fee,
    v_amount_net,
    'pending',
    now(),
    v_quote_id
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'amount_requested', v_amount,
    'transfer_fee', v_transfer_fee,
    'amount_net', v_amount_net,
    'status', 'pending',
    'wise_quote_id', v_quote_id,
    'self_billing_agreed_at', now(),
    'available_balance', public.get_mentor_wallet_available_balance(v_mentor_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_influencer_payout (
  p_amount numeric DEFAULT NULL,
  p_transfer_fee numeric DEFAULT 35,
  p_wise_quote_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_available numeric;
  v_amount numeric;
  v_transfer_fee numeric := round(greatest(coalesce(p_transfer_fee, 35), 0), 2);
  v_amount_net numeric;
  v_request_id uuid;
  v_min_amount numeric := 500;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT public.is_influencer_approved(v_user_id) THEN
    RAISE EXCEPTION 'influencer_not_approved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.influencer_payout_accounts AS ipa
    WHERE ipa.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'payout_account_required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('influencer_payout:' || v_user_id::text));

  IF EXISTS (
    SELECT 1
    FROM public.influencer_payout_requests AS ipr
    WHERE ipr.influencer_id = v_user_id
      AND ipr.status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'payout_request_already_active';
  END IF;

  v_available := public.get_influencer_wallet_available_balance(v_user_id);
  v_amount := round(coalesce(p_amount, v_available), 2);

  IF v_amount < v_min_amount THEN
    RAISE EXCEPTION 'payout_amount_below_minimum';
  END IF;

  IF v_amount > v_available THEN
    RAISE EXCEPTION 'payout_insufficient_balance';
  END IF;

  v_amount_net := round(v_amount - v_transfer_fee, 2);

  IF v_amount_net <= 0 THEN
    RAISE EXCEPTION 'payout_amount_too_low_after_fee';
  END IF;

  INSERT INTO public.influencer_payout_requests (
    influencer_id,
    amount_requested,
    transfer_fee,
    amount_net,
    wise_quote_id,
    status
  )
  VALUES (
    v_user_id,
    v_amount,
    v_transfer_fee,
    v_amount_net,
    nullif(btrim(coalesce(p_wise_quote_id, '')), ''),
    'pending'
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'amount_requested', v_amount,
    'transfer_fee', v_transfer_fee,
    'amount_net', v_amount_net,
    'status', 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_mentor_payout (numeric, boolean, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_mentor_payout (numeric, boolean, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.request_influencer_payout (numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_influencer_payout (numeric, numeric, text) TO authenticated;
