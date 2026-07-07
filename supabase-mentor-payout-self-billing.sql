-- Mentör ödeme talebi: self-billing onay zaman damgası (UK muhasebe kanıtı)
-- supabase-mentor-wallet-payout-fee.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.mentor_payout_requests
ADD COLUMN IF NOT EXISTS self_billing_agreed_at timestamptz;

COMMENT ON COLUMN public.mentor_payout_requests.self_billing_agreed_at IS
  'Mentörün self-billing / gider makbuzu onayının alındığı UTC zamanı.';

DROP FUNCTION IF EXISTS public.request_mentor_payout (numeric);

CREATE OR REPLACE FUNCTION public.request_mentor_payout (
  p_amount numeric DEFAULT NULL,
  p_self_billing_agreed boolean DEFAULT false
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
  v_transfer_fee_amount numeric := 35;
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

  v_available := public.get_mentor_wallet_available_balance(v_mentor_id);
  v_amount := round(coalesce(p_amount, v_available), 2);

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'payout_amount_invalid';
  END IF;

  IF v_amount > v_available THEN
    RAISE EXCEPTION 'payout_insufficient_balance';
  END IF;

  v_transfer_fee := v_transfer_fee_amount;

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
    self_billing_agreed_at
  )
  VALUES (
    v_mentor_id,
    v_amount,
    v_transfer_fee,
    v_amount_net,
    'pending',
    now()
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'amount_requested', v_amount,
    'transfer_fee', v_transfer_fee,
    'amount_net', v_amount_net,
    'status', 'pending',
    'self_billing_agreed_at', now(),
    'available_balance', public.get_mentor_wallet_available_balance(v_mentor_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_mentor_payout (numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_mentor_payout (numeric, boolean) TO authenticated;
