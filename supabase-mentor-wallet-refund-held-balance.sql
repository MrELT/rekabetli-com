-- İade tutarı: satış henüz çekilebilir değilse bekleyen bakiyeden düşülür (kullanılabilir bakiye negatif olmaz).
-- supabase-mentor-payout-min-amount.sql sonrasında bir kez çalıştırın.

CREATE OR REPLACE FUNCTION public.is_mentor_wallet_entry_withdrawable (
  p_entry_type text,
  p_package_order_id uuid,
  p_created_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN p_entry_type IN ('package_sale', 'referral_bonus') THEN
        coalesce(
          public.mentor_wallet_sale_withdrawable_at(p_package_order_id, p_created_at) <= now(),
          false
        )
      WHEN p_entry_type = 'refund' THEN
        coalesce(
          (
            SELECT public.is_mentor_wallet_entry_withdrawable(
              'package_sale',
              sale.package_order_id,
              sale.created_at
            )
            FROM public.mentor_wallet_ledger AS sale
            WHERE sale.package_order_id = p_package_order_id
              AND sale.entry_type = 'package_sale'
            LIMIT 1
          ),
          false
        )
      WHEN p_entry_type = 'referral_bonus_refund' THEN
        coalesce(
          (
            SELECT public.is_mentor_wallet_entry_withdrawable(
              'referral_bonus',
              bonus.package_order_id,
              bonus.created_at
            )
            FROM public.mentor_wallet_ledger AS bonus
            WHERE bonus.package_order_id = p_package_order_id
              AND bonus.entry_type = 'referral_bonus'
            LIMIT 1
          ),
          false
        )
      WHEN p_entry_type IN ('adjustment', 'payout') THEN
        true
      ELSE
        false
    END;
$$;

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
    AND mwl.entry_type IN ('package_sale', 'referral_bonus', 'refund', 'referral_bonus_refund')
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
        WHEN mwl.entry_type IN ('refund', 'referral_bonus_refund') THEN 2
        WHEN public.get_package_order_first_meeting_at(mwl.package_order_id) IS NULL THEN 0
        ELSE 1
      END AS sort_key
    FROM public.mentor_wallet_ledger AS mwl
    WHERE mwl.mentor_id = v_mentor_id
      AND mwl.entry_type IN ('package_sale', 'referral_bonus', 'refund', 'referral_bonus_refund')
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
    'payout_min_amount', public.get_mentor_payout_min_amount(),
    'transactions', v_transactions,
    'payout_requests', v_payout_requests
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mentor_wallet_summary () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_wallet_summary () TO authenticated;
