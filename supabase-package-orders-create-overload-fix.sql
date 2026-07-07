-- create_package_order(uuid, text) + create_package_order(uuid, text, boolean) birlikte
-- kalınca PostgREST PGRST203 verir ("Could not choose the best candidate function").
-- Tek imza bırak: (uuid, text, boolean DEFAULT true) + onaylı vitrin kontrolü.

DROP FUNCTION IF EXISTS public.create_package_order (uuid, text);

CREATE OR REPLACE FUNCTION public.create_package_order (
  p_mentor_id uuid,
  p_package_id text,
  p_apply_referral_credit boolean DEFAULT true
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
  v_available_credit numeric := 0;
  v_credit_applied numeric := 0;
  v_amount_due numeric;
  v_min_charge numeric := 9.25;
  v_canceled_id uuid;
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

  IF NOT public.mentor_vitrin_publicly_available(p_mentor_id) THEN
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

  FOR v_canceled_id IN
    SELECT po.id
    FROM public.package_orders AS po
    WHERE po.user_id = v_student_id
      AND po.mentor_id = p_mentor_id
      AND po.package_id = v_package_id
      AND po.status = 'pending'
  LOOP
    PERFORM public.release_student_referral_credit_reservations(v_canceled_id);
  END LOOP;

  UPDATE public.package_orders AS po
  SET status = 'canceled',
      updated_at = now()
  WHERE po.user_id = v_student_id
    AND po.mentor_id = p_mentor_id
    AND po.package_id = v_package_id
    AND po.status = 'pending';

  v_price := round(v_price, 2);
  v_amount_due := v_price;
  v_credit_applied := 0;

  IF coalesce(p_apply_referral_credit, true) THEN
    v_available_credit := public.get_student_referral_credit_available_balance(v_student_id);
    IF v_available_credit > 0 THEN
      v_credit_applied := least(
        v_available_credit,
        greatest(v_price - v_min_charge, 0)
      );
      v_amount_due := round(v_price - v_credit_applied, 2);
    END IF;
  END IF;

  INSERT INTO public.package_orders (
    user_id,
    mentor_id,
    package_id,
    package_title,
    list_price,
    referral_credit_applied,
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
    v_price,
    v_credit_applied,
    'try',
    'pending',
    v_expires_at,
    v_is_renewal
  )
  RETURNING id INTO v_order_id;

  IF v_credit_applied > 0 THEN
    PERFORM public.reserve_student_referral_credits(v_student_id, v_order_id, v_credit_applied);
  END IF;

  SELECT coalesce(public.notification_actor_label(p_mentor_id), 'Mentör')
  INTO v_mentor_name;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'mentor_id', p_mentor_id,
    'mentor_name', v_mentor_name,
    'package_id', v_package_id,
    'package_title', v_title,
    'list_price', v_price,
    'referral_credit_applied', v_credit_applied,
    'amount_due', v_amount_due,
    'currency', 'try',
    'amount_minor', (v_amount_due * 100)::bigint,
    'expires_at', v_expires_at,
    'is_renewal', v_is_renewal
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_package_order (uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_package_order (uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.create_package_order (uuid, text, boolean) IS
  'Öğrenci paket siparişi oluşturur (onaylı vitrin, davet indirimi, yenileme desteği).';
