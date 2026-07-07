-- Wise transfer ücreti: sabit 35 TL yerine talep anında iletilen güncel ücret.
-- supabase-mentor-payout-self-billing.sql sonrasında çalıştırın.

DROP FUNCTION IF EXISTS public.request_mentor_payout (numeric, boolean);

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

REVOKE ALL ON FUNCTION public.request_mentor_payout (numeric, boolean, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_mentor_payout (numeric, boolean, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.request_mentor_payout (numeric, boolean, numeric, text) IS
  'Mentör ödeme talebi. Transfer ücreti Wise quote ile hesaplanır ve p_transfer_fee olarak iletilir.';

-- Wise quote id transfer detaylarına eklendi (process-mentor-payout yeniden quote oluşturmasın).
CREATE OR REPLACE FUNCTION public.get_mentor_payout_transfer_details (p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mentor_payout_requests%ROWTYPE;
  v_account public.mentor_payout_accounts%ROWTYPE;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'payout_request_invalid';
  END IF;

  SELECT *
  INTO v_row
  FROM public.mentor_payout_requests AS mpr
  WHERE mpr.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_request_not_found';
  END IF;

  SELECT *
  INTO v_account
  FROM public.mentor_payout_accounts AS mpa
  WHERE mpa.user_id = v_row.mentor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_account_required';
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_row.id,
    'mentor_id', v_row.mentor_id,
    'amount_net', v_row.amount_net,
    'transfer_fee', v_row.transfer_fee,
    'amount_requested', v_row.amount_requested,
    'status', v_row.status,
    'wise_quote_id', v_row.wise_quote_id,
    'account_holder', v_account.account_holder,
    'bank_name', v_account.bank_name,
    'iban', v_account.iban,
    'wise_recipient_id', v_account.wise_recipient_id,
    'wise_recipient_iban', v_account.wise_recipient_iban
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mentor_payout_transfer_details (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_payout_transfer_details (uuid) TO service_role;

-- Cüzdan özeti: sabit 35 TL yerine Wise tahmini kullanılır (estimate-mentor-payout).
CREATE OR REPLACE FUNCTION public.get_mentor_wallet_summary ()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
  v_available numeric;
  v_held_balance numeric;
  v_hold_days integer;
  v_total_gross numeric;
  v_total_platform_fee numeric;
  v_total_stripe_fee numeric;
  v_total_net numeric;
  v_referral_bonus_total numeric;
  v_sale_count integer;
  v_pending_payout numeric;
  v_commission_pct numeric;
  v_transactions jsonb;
  v_payout_requests jsonb;
  v_held_balance_items jsonb;
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

  v_hold_days := public.get_mentor_payout_hold_days();
  v_commission_pct := round(public.get_platform_commission_rate() * 100, 2);

  SELECT
    coalesce(sum(mwl.gross_amount), 0),
    coalesce(sum(mwl.platform_fee), 0),
    coalesce(sum(mwl.stripe_fee), 0),
    coalesce(sum(mwl.net_amount), 0),
    count(*)::integer
  INTO v_total_gross, v_total_platform_fee, v_total_stripe_fee, v_total_net, v_sale_count
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.mentor_id = v_mentor_id
    AND mwl.entry_type = 'package_sale';

  SELECT coalesce(sum(mwl.net_amount), 0)
  INTO v_referral_bonus_total
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.mentor_id = v_mentor_id
    AND mwl.entry_type = 'referral_bonus';

  SELECT coalesce(sum(mwl.net_amount), 0)
  INTO v_held_balance
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.mentor_id = v_mentor_id
    AND mwl.entry_type IN ('package_sale', 'referral_bonus')
    AND NOT public.is_mentor_wallet_entry_withdrawable(
      mwl.entry_type,
      mwl.package_order_id,
      mwl.created_at
    );

  SELECT coalesce(jsonb_agg(row_to_json(hi)::jsonb ORDER BY hi.sort_key ASC, hi.withdrawable_at ASC NULLS LAST), '[]'::jsonb)
  INTO v_held_balance_items
  FROM (
    SELECT
      mwl.id,
      mwl.entry_type,
      mwl.package_title,
      mwl.student_display_name,
      mwl.net_amount,
      mwl.created_at,
      public.get_package_order_first_meeting_at(mwl.package_order_id) AS first_meeting_at,
      public.package_order_payout_hold_reason(mwl.package_order_id, mwl.created_at) AS payout_hold_reason,
      public.mentor_wallet_sale_withdrawable_at(mwl.package_order_id, mwl.created_at) AS withdrawable_at,
      CASE
        WHEN public.get_package_order_first_meeting_at(mwl.package_order_id) IS NULL THEN 0
        ELSE 1
      END AS sort_key
    FROM public.mentor_wallet_ledger AS mwl
    WHERE mwl.mentor_id = v_mentor_id
      AND mwl.entry_type IN ('package_sale', 'referral_bonus')
      AND NOT public.is_mentor_wallet_entry_withdrawable(
        mwl.entry_type,
        mwl.package_order_id,
        mwl.created_at
      )
  ) AS hi;

  SELECT coalesce(sum(mpr.amount_requested), 0)
  INTO v_pending_payout
  FROM public.mentor_payout_requests AS mpr
  WHERE mpr.mentor_id = v_mentor_id
    AND mpr.status IN ('pending', 'processing');

  v_available := public.get_mentor_wallet_available_balance(v_mentor_id);

  SELECT coalesce(jsonb_agg(row_to_json(tx)::jsonb ORDER BY tx.created_at DESC), '[]'::jsonb)
  INTO v_transactions
  FROM (
    SELECT
      mwl.id,
      mwl.entry_type,
      mwl.package_title,
      mwl.student_display_name,
      mwl.gross_amount,
      mwl.platform_fee,
      mwl.net_amount,
      mwl.currency,
      mwl.created_at,
      public.is_mentor_wallet_entry_withdrawable(
        mwl.entry_type,
        mwl.package_order_id,
        mwl.created_at
      ) AS is_withdrawable,
      public.get_package_order_first_meeting_at(mwl.package_order_id) AS first_meeting_at,
      public.package_order_payout_hold_reason(mwl.package_order_id, mwl.created_at) AS payout_hold_reason,
      CASE
        WHEN mwl.entry_type IN ('package_sale', 'referral_bonus') THEN
          public.mentor_wallet_sale_withdrawable_at(mwl.package_order_id, mwl.created_at)
        ELSE NULL
      END AS withdrawable_at
    FROM public.mentor_wallet_ledger AS mwl
    WHERE mwl.mentor_id = v_mentor_id
    ORDER BY mwl.created_at DESC
    LIMIT 50
  ) AS tx;

  SELECT coalesce(jsonb_agg(row_to_json(pr)::jsonb ORDER BY pr.created_at DESC), '[]'::jsonb)
  INTO v_payout_requests
  FROM (
    SELECT
      mpr.id,
      mpr.amount_requested,
      mpr.transfer_fee,
      mpr.amount_net,
      mpr.status,
      mpr.created_at,
      mpr.processed_at
    FROM public.mentor_payout_requests AS mpr
    WHERE mpr.mentor_id = v_mentor_id
    ORDER BY mpr.created_at DESC
    LIMIT 20
  ) AS pr;

  RETURN jsonb_build_object(
    'available_balance', v_available,
    'held_balance', v_held_balance,
    'held_balance_items', v_held_balance_items,
    'payout_hold_days', v_hold_days,
    'payout_hold_anchor', 'first_meeting',
    'total_gross', v_total_gross,
    'total_platform_fee', v_total_platform_fee,
    'total_net', v_total_net,
    'referral_bonus_total', v_referral_bonus_total,
    'sale_count', v_sale_count,
    'pending_payout', v_pending_payout,
    'commission_rate_pct', v_commission_pct,
    'payment_fees_covered_by_platform', true,
    'payout_fee_source', 'wise',
    'transactions', v_transactions,
    'payout_requests', v_payout_requests
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mentor_wallet_summary () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_wallet_summary () TO authenticated;
