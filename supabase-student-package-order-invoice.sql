-- Öğrenci işlem geçmişi: Stripe fatura bağlantıları
-- Ön koşul: supabase-package-payment-invoice-email.sql

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
      coalesce(po.referral_credit_applied, 0) AS referral_credit_applied,
      po.stripe_hosted_invoice_url,
      po.stripe_invoice_pdf_url,
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
