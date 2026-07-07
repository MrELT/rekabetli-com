-- Aynı paketin tekrar satın alınmasına izin verir.
-- supabase-package-orders.sql sonrasında bir kez çalıştırın.

DROP INDEX IF EXISTS public.package_orders_paid_user_mentor_package_uidx;

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
    expires_at
  )
  VALUES (
    v_student_id,
    p_mentor_id,
    v_package_id,
    v_title,
    round(v_price, 2),
    'try',
    'pending',
    v_expires_at
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
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_package_order (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_package_order (uuid, text) TO authenticated;

COMMENT ON FUNCTION public.create_package_order (uuid, text) IS
  'Mentör vitrin paketi için Stripe ödeme siparişi oluşturur. Aynı paket tekrar satın alınabilir.';
