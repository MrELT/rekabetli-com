-- Mentör komisyon politikası: yalnızca %20 platform komisyonu; Stripe/kur ücretleri platforma ait.
-- supabase-mentor-wallet.sql sonrasında bir kez çalıştırın.

CREATE OR REPLACE FUNCTION public.calculate_package_sale_fees (p_gross numeric)
RETURNS TABLE (
  gross_amount numeric,
  platform_fee numeric,
  stripe_fee numeric,
  net_amount numeric
)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    round(greatest(p_gross, 0), 2) AS gross_amount,
    round(greatest(p_gross, 0) * public.get_platform_commission_rate(), 2) AS platform_fee,
    public.estimate_stripe_processing_fee(p_gross) AS stripe_fee,
    round(
      greatest(p_gross, 0)
      - (greatest(p_gross, 0) * public.get_platform_commission_rate()),
      2
    ) AS net_amount;
$$;

COMMENT ON FUNCTION public.calculate_package_sale_fees (numeric) IS
  'Mentör net = brüt − %20 platform komisyonu. stripe_fee yalnızca platform muhasebesi içindir; mentörden düşülmez.';

CREATE OR REPLACE FUNCTION public.record_mentor_wallet_sale (p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_fees record;
  v_student_name text;
  v_ledger_id uuid;
  v_gross numeric;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_order
  FROM public.package_orders AS po
  WHERE po.id = p_order_id;

  IF NOT FOUND OR v_order.status <> 'paid' THEN
    RETURN NULL;
  END IF;

  v_gross := round(coalesce(v_order.amount_paid, v_order.list_price), 2);

  SELECT *
  INTO v_fees
  FROM public.calculate_package_sale_fees(v_gross, NULL::numeric) AS f;

  SELECT id
  INTO v_ledger_id
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.package_order_id = p_order_id
    AND mwl.entry_type = 'package_sale'
  LIMIT 1;

  v_student_name := coalesce(public.notification_actor_label(v_order.user_id), 'Öğrenci');

  IF v_ledger_id IS NOT NULL THEN
    UPDATE public.mentor_wallet_ledger AS mwl
    SET gross_amount = v_fees.gross_amount,
        platform_fee = v_fees.platform_fee,
        stripe_fee = v_fees.stripe_fee,
        net_amount = v_fees.net_amount
    WHERE mwl.id = v_ledger_id;
  ELSE
    INSERT INTO public.mentor_wallet_ledger (
      mentor_id,
      package_order_id,
      entry_type,
      gross_amount,
      platform_fee,
      stripe_fee,
      net_amount,
      currency,
      package_title,
      student_display_name
    )
    VALUES (
      v_order.mentor_id,
      v_order.id,
      'package_sale',
      v_fees.gross_amount,
      v_fees.platform_fee,
      v_fees.stripe_fee,
      v_fees.net_amount,
      lower(trim(v_order.currency)),
      v_order.package_title,
      v_student_name
    )
    RETURNING id INTO v_ledger_id;
  END IF;

  UPDATE public.package_orders
  SET platform_fee = v_fees.platform_fee,
      stripe_fee = v_fees.stripe_fee,
      updated_at = now()
  WHERE id = v_order.id;

  RETURN v_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_mentor_wallet_sale (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mentor_wallet_sale (uuid) TO service_role;

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
      mwl.created_at
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

DO $$
DECLARE
  v_order_id uuid;
BEGIN
  FOR v_order_id IN
    SELECT po.id
    FROM public.package_orders AS po
    WHERE po.status = 'paid'
  LOOP
    PERFORM public.record_mentor_wallet_sale(v_order_id);
  END LOOP;
END;
$$;
