-- Ödeme başarı sayfası: öğrenci kendi checkout session siparişini okur
-- supabase-package-orders.sql sonrasında bir kez çalıştırın.

CREATE OR REPLACE FUNCTION public.get_my_package_order_by_checkout_session (
  p_stripe_checkout_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_session_id text := btrim(coalesce(p_stripe_checkout_session_id, ''));
  v_row public.package_orders%ROWTYPE;
BEGIN
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF v_session_id = '' OR char_length(v_session_id) > 255 THEN
    RAISE EXCEPTION 'package_order_invalid_session';
  END IF;

  SELECT *
  INTO v_row
  FROM public.package_orders AS po
  WHERE po.stripe_checkout_session_id = v_session_id
    AND po.user_id = v_student_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_row.id,
    'mentor_id', v_row.mentor_id,
    'package_id', v_row.package_id,
    'package_title', v_row.package_title,
    'list_price', v_row.list_price,
    'amount_paid', v_row.amount_paid,
    'currency', v_row.currency,
    'status', v_row.status,
    'enrollment_id', v_row.enrollment_id,
    'paid_at', v_row.paid_at,
    'expires_at', v_row.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_package_order_by_checkout_session (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_package_order_by_checkout_session (text) TO authenticated;

COMMENT ON FUNCTION public.get_my_package_order_by_checkout_session (text) IS
  'Ödeme başarı sayfası: oturum açmış öğrenci kendi Stripe checkout session siparişini okur.';
