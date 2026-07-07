-- Paket iadesinde öğrenciye ödeme sistemi (Stripe) komisyonu düşülür.
-- supabase-package-orders-refund.sql sonrasında çalıştırın.

DROP FUNCTION IF EXISTS public.complete_package_refund (uuid, text, text);

ALTER TABLE public.package_orders
ADD COLUMN IF NOT EXISTS refund_amount numeric(12, 2),
ADD COLUMN IF NOT EXISTS refund_stripe_fee_retained numeric(12, 2);

COMMENT ON COLUMN public.package_orders.refund_amount IS
  'Öğrenciye Stripe üzerinden iade edilen net tutar (brüt − ödeme sistemi komisyonu).';

COMMENT ON COLUMN public.package_orders.refund_stripe_fee_retained IS
  'Gerekçesiz / erken iptalde öğrenciye iade edilmeyen ödeme sistemi komisyonu.';

CREATE OR REPLACE FUNCTION public.calculate_package_student_refund (
  p_amount_paid numeric,
  p_stripe_fee numeric DEFAULT NULL
)
RETURNS TABLE (
  gross_amount numeric,
  stripe_fee_retained numeric,
  refund_amount numeric
)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH base AS (
    SELECT round(greatest(coalesce(p_amount_paid, 0), 0), 2) AS gross
  )
  SELECT
    base.gross AS gross_amount,
  coalesce(
    nullif(round(greatest(coalesce(p_stripe_fee, 0), 0), 2), 0),
    public.estimate_stripe_processing_fee(base.gross)
  ) AS stripe_fee_retained,
  greatest(
    round(
      base.gross - coalesce(
        nullif(round(greatest(coalesce(p_stripe_fee, 0), 0), 2), 0),
        public.estimate_stripe_processing_fee(base.gross)
      ),
      2
    ),
    0
  ) AS refund_amount
  FROM base;
$$;

CREATE OR REPLACE FUNCTION public.get_package_refund_amounts (p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_calc record;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'package_order_invalid';
  END IF;

  SELECT *
  INTO v_order
  FROM public.package_orders AS po
  WHERE po.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_order_not_found';
  END IF;

  SELECT *
  INTO v_calc
  FROM public.calculate_package_student_refund(
    coalesce(v_order.amount_paid, v_order.list_price),
    v_order.stripe_fee
  ) AS c;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'amount_paid', v_calc.gross_amount,
    'stripe_fee_retained', v_calc.stripe_fee_retained,
    'refund_amount', v_calc.refund_amount,
    'currency', v_order.currency
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_package_refund_amounts (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_package_refund_amounts (uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_package_refund (
  p_order_id uuid,
  p_stripe_refund_id text DEFAULT NULL,
  p_refund_reason text DEFAULT '',
  p_refund_amount numeric DEFAULT NULL,
  p_stripe_fee_retained numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_student_label text;
  v_mentor_label text;
  v_wallet_ledger_id uuid;
  v_calc record;
  v_refund_amount numeric;
  v_stripe_fee_retained numeric;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'package_order_invalid';
  END IF;

  SELECT *
  INTO v_order
  FROM public.package_orders AS po
  WHERE po.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_order_not_found';
  END IF;

  IF v_order.status = 'refunded' THEN
    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'status', 'refunded',
      'already_refunded', true,
      'refund_amount', v_order.refund_amount,
      'stripe_fee_retained', v_order.refund_stripe_fee_retained
    );
  END IF;

  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'package_order_not_refundable';
  END IF;

  SELECT *
  INTO v_calc
  FROM public.calculate_package_student_refund(
    coalesce(v_order.amount_paid, v_order.list_price),
    v_order.stripe_fee
  ) AS c;

  v_refund_amount := coalesce(p_refund_amount, v_calc.refund_amount);
  v_stripe_fee_retained := coalesce(p_stripe_fee_retained, v_calc.stripe_fee_retained);

  PERFORM public.service_unenroll_student_from_package_order(v_order.id);

  UPDATE public.package_orders
  SET status = 'refunded',
      refunded_at = now(),
      stripe_refund_id = nullif(btrim(coalesce(p_stripe_refund_id, '')), ''),
      refund_reason = left(btrim(coalesce(p_refund_reason, '')), 500),
      refund_amount = v_refund_amount,
      refund_stripe_fee_retained = v_stripe_fee_retained,
      updated_at = now()
  WHERE id = v_order.id;

  v_wallet_ledger_id := public.record_mentor_wallet_refund(v_order.id);

  v_student_label := coalesce(public.notification_actor_label(v_order.user_id), 'Öğrenci');
  v_mentor_label := coalesce(public.notification_actor_label(v_order.mentor_id), 'Mentör');

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    body_text
  )
  VALUES (
    v_order.user_id,
    v_order.mentor_id,
    v_mentor_label,
    'mentor_package_refunded',
    v_order.mentor_id,
    v_order.package_title || ' paketi için iadeniz işlendi. Kartınıza yansıyacak tutar: '
      || to_char(v_refund_amount, 'FM999999990.00') || ' ₺'
      || CASE
        WHEN v_stripe_fee_retained > 0 THEN
          ' (ödeme sistemi komisyonu ' || to_char(v_stripe_fee_retained, 'FM999999990.00') || ' ₺ düşüldü).'
        ELSE '.'
      END
      || ' Yansıma 5–10 iş günü sürebilir.'
  );

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    body_text
  )
  VALUES (
    v_order.mentor_id,
    v_order.user_id,
    v_student_label,
    'mentor_package_refunded',
    v_order.mentor_id,
    v_student_label || ' · ' || v_order.package_title || ' paketi için iade yapıldı; satış tutarı cüzdanınızdan düşüldü.'
  );

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', 'refunded',
    'wallet_ledger_id', v_wallet_ledger_id,
    'refund_amount', v_refund_amount,
    'stripe_fee_retained', v_stripe_fee_retained
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_package_refund (uuid, text, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_package_refund (uuid, text, text, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.request_package_refund (
  p_order_id uuid,
  p_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order public.package_orders%ROWTYPE;
  v_note text := left(btrim(coalesce(p_note, '')), 500);
  v_mentor_label text;
  v_calc record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'package_order_invalid';
  END IF;

  SELECT *
  INTO v_order
  FROM public.package_orders AS po
  WHERE po.id = p_order_id
    AND po.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_order_not_found';
  END IF;

  IF v_order.status = 'refunded' THEN
    RAISE EXCEPTION 'package_order_already_refunded';
  END IF;

  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'package_order_not_refundable';
  END IF;

  IF v_order.refund_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'package_refund_already_requested';
  END IF;

  IF v_order.paid_at IS NOT NULL AND v_order.paid_at < now() - interval '14 days' THEN
    RAISE EXCEPTION 'package_refund_window_expired';
  END IF;

  SELECT *
  INTO v_calc
  FROM public.calculate_package_student_refund(
    coalesce(v_order.amount_paid, v_order.list_price),
    v_order.stripe_fee
  ) AS c;

  UPDATE public.package_orders
  SET refund_requested_at = now(),
      refund_request_note = v_note,
      updated_at = now()
  WHERE id = v_order.id;

  v_mentor_label := coalesce(public.notification_actor_label(v_order.mentor_id), 'Mentör');

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    body_text
  )
  VALUES (
    v_order.mentor_id,
    v_user_id,
    coalesce(public.notification_actor_label(v_user_id), 'Öğrenci'),
    'mentor_package_refund_requested',
    v_order.mentor_id,
    coalesce(public.notification_actor_label(v_user_id), 'Öğrenci')
      || ' · ' || v_order.package_title || ' paketi için iade talep etti.'
      || CASE WHEN v_note <> '' THEN ' Not: ' || v_note ELSE '' END
  );

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'refund_requested_at', now(),
    'status', v_order.status,
    'amount_paid', v_calc.gross_amount,
    'stripe_fee_retained', v_calc.stripe_fee_retained,
    'refund_amount', v_calc.refund_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_package_refund (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_package_refund (uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_refund_queue ()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  RETURN coalesce(
    (
      SELECT jsonb_agg(row_to_json(q)::jsonb ORDER BY q.refund_requested_at DESC)
      FROM (
        SELECT
          po.id,
          po.package_title,
          po.amount_paid,
          calc.refund_amount,
          calc.stripe_fee_retained,
          po.currency,
          po.paid_at,
          po.refund_requested_at,
          po.refund_request_note,
          po.stripe_payment_intent_id,
          po.user_id,
          po.mentor_id,
          coalesce(public.notification_actor_label(po.user_id), 'Öğrenci') AS student_name,
          coalesce(public.notification_actor_label(po.mentor_id), 'Mentör') AS mentor_name
        FROM public.package_orders AS po
        CROSS JOIN LATERAL public.calculate_package_student_refund(
          coalesce(po.amount_paid, po.list_price),
          po.stripe_fee
        ) AS calc
        WHERE po.status = 'paid'
          AND po.refund_requested_at IS NOT NULL
        ORDER BY po.refund_requested_at DESC
        LIMIT 100
      ) AS q
    ),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_refund_queue () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_refund_queue () TO authenticated;

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

  RETURN jsonb_build_object(
    'orders', v_orders,
    'total_spent', v_total_spent,
    'purchase_count', v_purchase_count,
    'refund_window_days', 14
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_package_orders () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_package_orders () TO authenticated;
