-- Paket yenileme (tekrar satın alma) siparişlerini ilk satıştan ayırır.
-- supabase-package-orders-repurchase.sql ve supabase-mentor-wallet-payout-hold-first-meeting.sql sonrasında çalıştırın.

ALTER TABLE public.package_orders
ADD COLUMN IF NOT EXISTS is_renewal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.package_orders.is_renewal IS
  'Öğrenci aynı mentör paketini daha önce satın almışsa true (yenileme).';

CREATE OR REPLACE FUNCTION public.package_order_is_renewal (
  p_user_id uuid,
  p_mentor_id uuid,
  p_package_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.mentor_package_students AS mps
      WHERE mps.mentor_id = p_mentor_id
        AND mps.student_id = p_user_id
        AND mps.package_id = p_package_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.package_orders AS po
      WHERE po.user_id = p_user_id
        AND po.mentor_id = p_mentor_id
        AND po.package_id = p_package_id
        AND po.status = 'paid'
    );
$$;

REVOKE ALL ON FUNCTION public.package_order_is_renewal (uuid, uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_package_order (
  p_mentor_id uuid,
  p_package_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_package_id text := btrim(coalesce(p_package_id, ''));
  v_title text;
  v_price numeric;
  v_capacity integer;
  v_usage integer;
  v_order_id uuid;
  v_expires_at timestamptz := now() + interval '30 minutes';
  v_mentor_name text;
  v_already_enrolled boolean := false;
  v_is_renewal boolean := false;
BEGIN
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_mentor_id IS NULL OR p_mentor_id = v_student_id THEN
    RAISE EXCEPTION 'package_order_self_not_allowed';
  END IF;

  IF v_package_id = ''
    OR char_length(v_package_id) > 64
    OR v_package_id !~ '^[a-zA-Z0-9_-]+$' THEN
    RAISE EXCEPTION 'package_order_invalid_package';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'package_order_invalid_mentor';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_pages AS mp
    WHERE mp.user_id = p_mentor_id
      AND COALESCE(mp.vitrin_active, true) = true
  ) THEN
    RAISE EXCEPTION 'package_order_mentor_unavailable';
  END IF;

  SELECT offer.package_title, offer.list_price, offer.package_capacity
  INTO v_title, v_price, v_capacity
  FROM public.resolve_mentor_package_offer(p_mentor_id, v_package_id) AS offer;

  IF v_title IS NULL OR v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'package_order_package_not_found';
  END IF;

  v_is_renewal := public.package_order_is_renewal(v_student_id, p_mentor_id, v_package_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
      AND mps.student_id = v_student_id
      AND mps.package_id = v_package_id
  )
  INTO v_already_enrolled;

  IF v_capacity IS NOT NULL AND v_capacity > 0 AND NOT v_already_enrolled THEN
    v_usage := public.count_package_capacity_usage(p_mentor_id, v_package_id);
    IF v_usage >= v_capacity THEN
      RAISE EXCEPTION 'package_order_capacity_full';
    END IF;
  END IF;

  UPDATE public.package_orders AS po
  SET status = 'canceled',
      updated_at = now()
  WHERE po.user_id = v_student_id
    AND po.mentor_id = p_mentor_id
    AND po.package_id = v_package_id
    AND po.status = 'pending';

  INSERT INTO public.package_orders (
    user_id,
    mentor_id,
    package_id,
    package_title,
    list_price,
    currency,
    status,
    expires_at,
    is_renewal
  )
  VALUES (
    v_student_id,
    p_mentor_id,
    v_package_id,
    v_title,
    round(v_price, 2),
    'try',
    'pending',
    v_expires_at,
    v_is_renewal
  )
  RETURNING id INTO v_order_id;

  SELECT coalesce(public.notification_actor_label(p_mentor_id), 'Mentör')
  INTO v_mentor_name;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'mentor_id', p_mentor_id,
    'mentor_name', v_mentor_name,
    'package_id', v_package_id,
    'package_title', v_title,
    'list_price', round(v_price, 2),
    'currency', 'try',
    'amount_minor', (round(v_price, 2) * 100)::bigint,
    'expires_at', v_expires_at,
    'is_renewal', v_is_renewal
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_package_order (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_package_order (uuid, text) TO authenticated;

-- Mevcut ödenmiş siparişleri yenileme olarak işaretle (ilk satış hariç).
UPDATE public.package_orders AS po
SET is_renewal = true
WHERE po.status = 'paid'
  AND po.is_renewal = false
  AND EXISTS (
    SELECT 1
    FROM public.package_orders AS earlier
    WHERE earlier.user_id = po.user_id
      AND earlier.mentor_id = po.mentor_id
      AND earlier.package_id = po.package_id
      AND earlier.status = 'paid'
      AND earlier.id <> po.id
      AND coalesce(earlier.paid_at, earlier.created_at)
        < coalesce(po.paid_at, po.created_at)
  );

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
  SELECT
    CASE
      WHEN po.id IS NULL THEN NULL
      WHEN po.is_renewal THEN
        coalesce(po.paid_at, p_created_at)
          + make_interval(days => public.get_mentor_payout_hold_days())
      ELSE (
        SELECT fm.first_meeting_at + make_interval(days => public.get_mentor_payout_hold_days())
        FROM (
          SELECT public.get_package_order_first_meeting_at(p_package_order_id) AS first_meeting_at
        ) AS fm
        WHERE fm.first_meeting_at IS NOT NULL
      )
    END
  FROM public.package_orders AS po
  WHERE po.id = p_package_order_id;
$$;

COMMENT ON FUNCTION public.mentor_wallet_sale_withdrawable_at (uuid, timestamptz) IS
  'İlk satış: onaylanan ilk görüşme + bekleme. Yenileme: ödeme tarihi + bekleme.';

CREATE OR REPLACE FUNCTION public.package_order_payout_hold_reason (
  p_package_order_id uuid,
  p_created_at timestamptz
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN p_package_order_id IS NULL THEN NULL
      WHEN po.is_renewal THEN
        CASE
          WHEN coalesce(
            public.mentor_wallet_sale_withdrawable_at(p_package_order_id, p_created_at) > now(),
            true
          ) THEN 'waiting_hold_period'
          ELSE NULL
        END
      WHEN public.get_package_order_first_meeting_at(p_package_order_id) IS NULL THEN 'waiting_first_meeting'
      WHEN coalesce(
        public.mentor_wallet_sale_withdrawable_at(p_package_order_id, p_created_at) > now(),
        true
      ) THEN 'waiting_hold_period'
      ELSE NULL
    END
  FROM public.package_orders AS po
  WHERE po.id = p_package_order_id;
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
  v_renewal_sale_count integer;
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

  SELECT count(*)::integer
  INTO v_renewal_sale_count
  FROM public.mentor_wallet_ledger AS mwl
  JOIN public.package_orders AS po ON po.id = mwl.package_order_id
  WHERE mwl.mentor_id = v_mentor_id
    AND mwl.entry_type = 'package_sale'
    AND po.is_renewal = true;

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
      coalesce(po.is_renewal, false) AS is_renewal,
      CASE
        WHEN coalesce(po.is_renewal, false) THEN NULL
        ELSE public.get_package_order_first_meeting_at(mwl.package_order_id)
      END AS first_meeting_at,
      public.package_order_payout_hold_reason(mwl.package_order_id, mwl.created_at) AS payout_hold_reason,
      public.mentor_wallet_sale_withdrawable_at(mwl.package_order_id, mwl.created_at) AS withdrawable_at,
      CASE
        WHEN coalesce(po.is_renewal, false) THEN 2
        WHEN public.get_package_order_first_meeting_at(mwl.package_order_id) IS NULL THEN 0
        ELSE 1
      END AS sort_key
    FROM public.mentor_wallet_ledger AS mwl
    LEFT JOIN public.package_orders AS po ON po.id = mwl.package_order_id
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
      coalesce(po.is_renewal, false) AS is_renewal,
      public.is_mentor_wallet_entry_withdrawable(
        mwl.entry_type,
        mwl.package_order_id,
        mwl.created_at
      ) AS is_withdrawable,
      CASE
        WHEN coalesce(po.is_renewal, false) THEN NULL
        ELSE public.get_package_order_first_meeting_at(mwl.package_order_id)
      END AS first_meeting_at,
      public.package_order_payout_hold_reason(mwl.package_order_id, mwl.created_at) AS payout_hold_reason,
      CASE
        WHEN mwl.entry_type IN ('package_sale', 'referral_bonus') THEN
          public.mentor_wallet_sale_withdrawable_at(mwl.package_order_id, mwl.created_at)
        ELSE NULL
      END AS withdrawable_at
    FROM public.mentor_wallet_ledger AS mwl
    LEFT JOIN public.package_orders AS po ON po.id = mwl.package_order_id
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
    'renewal_sale_count', v_renewal_sale_count,
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

CREATE OR REPLACE FUNCTION public.get_my_package_orders ()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_orders jsonb;
  v_total_spent numeric;
  v_purchase_count integer;
  v_renewal_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(o)::jsonb ORDER BY o.paid_at DESC NULLS LAST, o.created_at DESC), '[]'::jsonb)
  INTO v_orders
  FROM (
    SELECT
      po.id,
      po.package_title,
      po.package_id,
      po.mentor_id,
      coalesce(public.notification_actor_label(po.mentor_id), 'Mentör') AS mentor_name,
      po.list_price,
      coalesce(po.amount_paid, po.list_price) AS amount_paid,
      calc.refund_amount,
      calc.stripe_fee_retained,
      po.refund_amount AS refunded_amount,
      po.refund_stripe_fee_retained AS refunded_stripe_fee_retained,
      po.currency,
      po.status,
      po.paid_at,
      po.refund_requested_at,
      po.refunded_at,
      po.refund_request_note,
      po.enrollment_id,
      po.is_renewal,
      po.created_at,
      (
        po.status = 'paid'
        AND po.refund_requested_at IS NULL
        AND po.paid_at IS NOT NULL
        AND po.paid_at >= now() - interval '14 days'
      ) AS refund_eligible
    FROM public.package_orders AS po
    CROSS JOIN LATERAL public.calculate_package_student_refund(
      coalesce(po.amount_paid, po.list_price),
      po.stripe_fee
    ) AS calc
    WHERE po.user_id = v_user_id
      AND po.status IN ('paid', 'refunded')
    ORDER BY coalesce(po.paid_at, po.created_at) DESC
    LIMIT 50
  ) AS o;

  SELECT
    coalesce(sum(coalesce(po.amount_paid, po.list_price)), 0),
    count(*)::integer
  INTO v_total_spent, v_purchase_count
  FROM public.package_orders AS po
  WHERE po.user_id = v_user_id
    AND po.status = 'paid';

  SELECT count(*)::integer
  INTO v_renewal_count
  FROM public.package_orders AS po
  WHERE po.user_id = v_user_id
    AND po.status = 'paid'
    AND po.is_renewal = true;

  RETURN jsonb_build_object(
    'orders', v_orders,
    'total_spent', v_total_spent,
    'purchase_count', v_purchase_count,
    'renewal_count', v_renewal_count,
    'refund_window_days', 14
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_package_orders () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_package_orders () TO authenticated;
