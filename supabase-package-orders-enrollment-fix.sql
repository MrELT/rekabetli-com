-- Ödeme sonrası paket kaydı onarımı
-- supabase-package-orders.sql sonrasında bir kez çalıştırın.
-- Webhook gecikirse veya enrollment_id boş kalırsa kayıt tamamlanır.

CREATE OR REPLACE FUNCTION public.ensure_mentor_package_enrollment (
  p_mentor_id uuid,
  p_student_id uuid,
  p_package_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_id text := btrim(coalesce(p_package_id, ''));
  v_enrollment_id uuid;
  v_already_enrolled boolean := false;
BEGIN
  IF p_mentor_id IS NULL OR p_student_id IS NULL OR p_mentor_id = p_student_id THEN
    RAISE EXCEPTION 'package_enrollment_invalid';
  END IF;

  IF v_package_id = ''
    OR char_length(v_package_id) > 64
    OR v_package_id !~ '^[a-zA-Z0-9_-]+$' THEN
    RAISE EXCEPTION 'package_enrollment_invalid_package';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_student_id
  ) THEN
    RAISE EXCEPTION 'student_profile_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
      AND mps.student_id = p_student_id
      AND mps.package_id = v_package_id
  ) THEN
    SELECT mps.id
    INTO v_enrollment_id
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
      AND mps.student_id = p_student_id
      AND mps.package_id = v_package_id
    LIMIT 1;

    v_already_enrolled := true;
  ELSE
    INSERT INTO public.mentor_linked_students (mentor_id, student_id)
    VALUES (p_mentor_id, p_student_id)
    ON CONFLICT ON CONSTRAINT mentor_linked_students_pair_unique DO NOTHING;

    INSERT INTO public.mentor_package_students (mentor_id, student_id, package_id)
    VALUES (p_mentor_id, p_student_id, v_package_id)
    ON CONFLICT ON CONSTRAINT mentor_package_students_unique DO NOTHING
    RETURNING id INTO v_enrollment_id;

    IF v_enrollment_id IS NULL THEN
      SELECT mps.id
      INTO v_enrollment_id
      FROM public.mentor_package_students AS mps
      WHERE mps.mentor_id = p_mentor_id
        AND mps.student_id = p_student_id
        AND mps.package_id = v_package_id
      LIMIT 1;

      v_already_enrolled := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'enrollment_id', v_enrollment_id,
    'already_enrolled', v_already_enrolled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_mentor_package_enrollment (uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_mentor_package_enrollment (uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_package_purchase (
  p_order_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_amount_paid numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_session_id text := NULLIF(btrim(coalesce(p_stripe_checkout_session_id, '')), '');
  v_payment_intent_id text := NULLIF(btrim(coalesce(p_stripe_payment_intent_id, '')), '');
  v_enrollment_id uuid;
  v_enrollment jsonb;
  v_student_label text;
  v_mentor_label text;
  v_already_enrolled boolean := false;
  v_repaired boolean := false;
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

  IF v_order.status = 'paid' THEN
    IF v_session_id IS NOT NULL
       AND v_order.stripe_checkout_session_id IS NOT NULL
       AND v_order.stripe_checkout_session_id <> v_session_id THEN
      RAISE EXCEPTION 'package_order_session_mismatch';
    END IF;

    IF v_order.enrollment_id IS NULL THEN
      v_enrollment := public.ensure_mentor_package_enrollment(
        v_order.mentor_id,
        v_order.user_id,
        v_order.package_id
      );
      v_enrollment_id := (v_enrollment ->> 'enrollment_id')::uuid;
      v_already_enrolled := coalesce((v_enrollment ->> 'already_enrolled')::boolean, false);

      UPDATE public.package_orders
      SET enrollment_id = v_enrollment_id,
          updated_at = now()
      WHERE id = v_order.id;

      v_repaired := true;
    END IF;

    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'enrollment_id', coalesce(v_order.enrollment_id, v_enrollment_id),
      'already_completed', true,
      'repaired', v_repaired
    );
  END IF;

  IF v_order.status = 'pending' THEN
    IF v_session_id IS NOT NULL
       AND v_order.stripe_checkout_session_id IS NOT NULL
       AND v_order.stripe_checkout_session_id <> v_session_id THEN
      RAISE EXCEPTION 'package_order_session_mismatch';
    END IF;

    IF v_order.expires_at IS NOT NULL AND v_order.expires_at <= now() THEN
      UPDATE public.package_orders
      SET status = 'expired',
          updated_at = now()
      WHERE id = v_order.id;
      RAISE EXCEPTION 'package_order_expired';
    END IF;
  ELSIF v_order.status IN ('canceled', 'expired') THEN
    IF v_session_id IS NULL
       OR v_order.stripe_checkout_session_id IS NULL
       OR v_order.stripe_checkout_session_id <> v_session_id THEN
      RAISE EXCEPTION 'package_order_not_pending';
    END IF;
  ELSE
    RAISE EXCEPTION 'package_order_not_pending';
  END IF;

  v_enrollment := public.ensure_mentor_package_enrollment(
    v_order.mentor_id,
    v_order.user_id,
    v_order.package_id
  );
  v_enrollment_id := (v_enrollment ->> 'enrollment_id')::uuid;
  v_already_enrolled := coalesce((v_enrollment ->> 'already_enrolled')::boolean, false);

  UPDATE public.package_orders
  SET status = 'paid',
      amount_paid = COALESCE(p_amount_paid, list_price),
      stripe_checkout_session_id = COALESCE(v_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = COALESCE(v_payment_intent_id, stripe_payment_intent_id),
      enrollment_id = v_enrollment_id,
      paid_at = now(),
      updated_at = now()
  WHERE id = v_order.id;

  IF NOT v_already_enrolled THEN
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
      'mentor_package_purchased',
      v_order.mentor_id,
      v_mentor_label || ' · ' || v_order.package_title || ' paketini satın aldınız.'
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
      'mentor_package_sale',
      v_order.mentor_id,
      v_student_label || ' · ' || v_order.package_title || ' paketinizi satın aldı.'
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', 'paid',
    'enrollment_id', v_enrollment_id,
    'already_completed', false,
    'already_enrolled', v_already_enrolled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) TO service_role;

COMMENT ON FUNCTION public.ensure_mentor_package_enrollment (uuid, uuid, text) IS
  'Ödeme veya onarım: mentör-öğrenci bağlantısı + paket kaydı oluşturur (idempotent).';
