-- Mentör çekim bekleme süresi: onaylanan ilk görüşmeden 14 gün sonra çekilebilir
-- supabase-mentor-wallet.sql sonrasında çalıştırın.
-- Canlı güncelleme: supabase-mentor-wallet-payout-hold-first-meeting.sql

CREATE OR REPLACE FUNCTION public.get_mentor_payout_hold_days ()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 14;
$$;

COMMENT ON FUNCTION public.get_mentor_payout_hold_days () IS
  'Onaylanan ilk görüşmeden sonra net tutarın çekilebilir olması için geçmesi gereken gün sayısı.';

CREATE OR REPLACE FUNCTION public.get_package_order_first_meeting_at (p_package_order_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT min(mmp.scheduled_starts_at)
  FROM public.package_orders AS po
  JOIN public.mentor_meeting_proposals AS mmp
    ON mmp.mentor_id = po.mentor_id
   AND mmp.student_id = po.user_id
   AND mmp.package_id = po.package_id
  WHERE po.id = p_package_order_id
    AND mmp.status = 'confirmed'
    AND mmp.scheduled_starts_at IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_package_order_first_meeting_at (uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.mentor_wallet_sale_withdrawable_at (
  p_package_order_id uuid,
  p_created_at timestamptz
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fm.first_meeting_at + make_interval(days => public.get_mentor_payout_hold_days())
  FROM (
    SELECT public.get_package_order_first_meeting_at(p_package_order_id) AS first_meeting_at
  ) AS fm
  WHERE fm.first_meeting_at IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.mentor_wallet_sale_withdrawable_at (uuid, timestamptz) FROM PUBLIC;

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
      WHEN p_entry_type <> 'package_sale' THEN true
      ELSE coalesce(
        public.mentor_wallet_sale_withdrawable_at(p_package_order_id, p_created_at) <= now(),
        false
      )
    END;
$$;

REVOKE ALL ON FUNCTION public.is_mentor_wallet_entry_withdrawable (text, uuid, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_mentor_wallet_available_balance (p_mentor_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT sum(mwl.net_amount)
      FROM public.mentor_wallet_ledger AS mwl
      WHERE mwl.mentor_id = p_mentor_id
        AND public.is_mentor_wallet_entry_withdrawable(
          mwl.entry_type,
          mwl.package_order_id,
          mwl.created_at
        )
    ),
    0
  ) - coalesce(
    (
      SELECT sum(mpr.amount_requested)
      FROM public.mentor_payout_requests AS mpr
      WHERE mpr.mentor_id = p_mentor_id
        AND mpr.status IN ('pending', 'processing')
    ),
    0
  );
$$;

REVOKE ALL ON FUNCTION public.get_mentor_wallet_available_balance (uuid) FROM PUBLIC;

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
  v_sale_count integer;
  v_pending_payout numeric;
  v_commission_pct numeric;
  v_transactions jsonb;
  v_payout_requests jsonb;
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
  INTO v_held_balance
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.mentor_id = v_mentor_id
    AND mwl.entry_type = 'package_sale'
    AND NOT public.is_mentor_wallet_entry_withdrawable(
      mwl.entry_type,
      mwl.package_order_id,
      mwl.created_at
    );

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
      CASE
        WHEN mwl.entry_type = 'package_sale' THEN
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
    'payout_hold_days', v_hold_days,
    'total_gross', v_total_gross,
    'total_platform_fee', v_total_platform_fee,
    'total_net', v_total_net,
    'sale_count', v_sale_count,
    'pending_payout', v_pending_payout,
    'commission_rate_pct', v_commission_pct,
    'payment_fees_covered_by_platform', true,
    'payout_transfer_fee', 35,
    'transactions', v_transactions,
    'payout_requests', v_payout_requests
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mentor_wallet_summary () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_wallet_summary () TO authenticated;
