-- Stripe fatura bağlantısı + öğrenci satın alma e-postası (Resend, seçenek C)
-- Ön koşul: supabase-student-referral-credits.sql
--
-- Akış:
--   1) complete_package_purchase → mentöre mentor_package_sale bildirimi (öğrenci e-postası burada değil)
--   2) stripe-webhook → Stripe faturası alınır → finalize_package_order_stripe_invoice
--   3) Öğrenciye mentor_package_purchased bildirimi + kuyruk → send-notification-email (fatura linki ile)

ALTER TABLE public.package_orders
ADD COLUMN IF NOT EXISTS stripe_invoice_id text,
ADD COLUMN IF NOT EXISTS stripe_hosted_invoice_url text,
ADD COLUMN IF NOT EXISTS stripe_invoice_pdf_url text;

COMMENT ON COLUMN public.package_orders.stripe_invoice_id IS
  'Stripe Invoice id (checkout invoice_creation).';
COMMENT ON COLUMN public.package_orders.stripe_hosted_invoice_url IS
  'Stripe hosted invoice page — öğrenci e-postasında paylaşılır.';
COMMENT ON COLUMN public.package_orders.stripe_invoice_pdf_url IS
  'Stripe invoice PDF indirme adresi.';

CREATE UNIQUE INDEX IF NOT EXISTS package_orders_stripe_invoice_uidx
ON public.package_orders (stripe_invoice_id)
WHERE stripe_invoice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Stripe faturası kaydı + öğrenci satın alma bildirimi (fatura linki hazır olduktan sonra)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_package_order_stripe_invoice (
  p_order_id uuid,
  p_stripe_invoice_id text,
  p_hosted_invoice_url text DEFAULT NULL,
  p_invoice_pdf_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_invoice_id text := NULLIF(btrim(coalesce(p_stripe_invoice_id, '')), '');
  v_hosted_url text := NULLIF(btrim(coalesce(p_hosted_invoice_url, '')), '');
  v_pdf_url text := NULLIF(btrim(coalesce(p_invoice_pdf_url, '')), '');
  v_mentor_label text;
  v_notification_id uuid;
  v_existing_notification_id uuid;
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

  IF v_order.status <> 'paid' THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'order_not_paid',
      'order_id', v_order.id,
      'status', v_order.status
    );
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    UPDATE public.package_orders
    SET stripe_invoice_id = v_invoice_id,
        stripe_hosted_invoice_url = COALESCE(v_hosted_url, stripe_hosted_invoice_url),
        stripe_invoice_pdf_url = COALESCE(v_pdf_url, stripe_invoice_pdf_url),
        updated_at = now()
    WHERE id = v_order.id;
  END IF;

  SELECT n.id
  INTO v_existing_notification_id
  FROM public.notifications AS n
  WHERE n.user_id = v_order.user_id
    AND n.type = 'mentor_package_purchased'
    AND n.enrollment_id IS NOT DISTINCT FROM v_order.enrollment_id
  ORDER BY n.created_at DESC
  LIMIT 1;

  IF v_existing_notification_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'invoice_id', v_invoice_id,
      'notification_id', v_existing_notification_id,
      'already_notified', true
    );
  END IF;

  IF v_order.enrollment_id IS NULL THEN
    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'invoice_id', v_invoice_id,
      'skipped_notification', true,
      'reason', 'missing_enrollment_id'
    );
  END IF;

  v_mentor_label := coalesce(public.notification_actor_label(v_order.mentor_id), 'Mentör');

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    mentor_id,
    enrollment_id,
    body_text
  )
  VALUES (
    v_order.user_id,
    v_order.mentor_id,
    v_mentor_label,
    'mentor_package_purchased',
    v_order.mentor_id,
    v_order.enrollment_id,
    v_mentor_label || ' · ' || v_order.package_title
      || ' paketini satın aldınız. Danışman panelinizden mentörünüzle iletişime geçebilir ve ilk görüşme zamanınızı planlayabilirsiniz.'
  )
  RETURNING id INTO v_notification_id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'invoice_id', v_invoice_id,
    'hosted_url', v_hosted_url,
    'pdf_url', v_pdf_url,
    'notification_id', v_notification_id,
    'already_notified', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_package_order_stripe_invoice (uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_package_order_stripe_invoice (uuid, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- complete_package_purchase: mentör satış bildirimi geri; öğrenci e-postası webhook'ta
-- ---------------------------------------------------------------------------

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
  v_wallet_ledger_id uuid;
  v_gross numeric;
  v_student_credit_id uuid;
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

      UPDATE public.package_orders
      SET enrollment_id = v_enrollment_id,
          updated_at = now()
      WHERE id = v_order.id;

      v_repaired := true;
    END IF;

    v_wallet_ledger_id := public.record_mentor_wallet_sale(v_order.id);
    PERFORM public.finalize_student_referral_credits_for_order(v_order.id);
    PERFORM public.record_student_referral_credit(v_order.id);

    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'enrollment_id', coalesce(v_order.enrollment_id, v_enrollment_id),
      'wallet_ledger_id', v_wallet_ledger_id,
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
      PERFORM public.release_student_referral_credit_reservations(v_order.id);
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

  v_gross := round(coalesce(p_amount_paid, v_order.list_price - coalesce(v_order.referral_credit_applied, 0)), 2);

  UPDATE public.package_orders
  SET status = 'paid',
      amount_paid = v_gross,
      stripe_checkout_session_id = COALESCE(v_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = COALESCE(v_payment_intent_id, stripe_payment_intent_id),
      enrollment_id = v_enrollment_id,
      paid_at = now(),
      updated_at = now()
  WHERE id = v_order.id;

  v_wallet_ledger_id := public.record_mentor_wallet_sale(v_order.id);
  PERFORM public.finalize_student_referral_credits_for_order(v_order.id);
  v_student_credit_id := public.record_student_referral_credit(v_order.id);

  IF NOT v_already_enrolled THEN
    v_student_label := coalesce(public.notification_actor_label(v_order.user_id), 'Öğrenci');
    v_mentor_label := coalesce(public.notification_actor_label(v_order.mentor_id), 'Mentör');

    INSERT INTO public.notifications (
      user_id,
      actor_id,
      actor_name,
      type,
      mentor_id,
      enrollment_id,
      body_text
    )
    VALUES (
      v_order.mentor_id,
      v_order.user_id,
      v_student_label,
      'mentor_package_sale',
      v_order.mentor_id,
      v_enrollment_id,
      v_student_label || ' · ' || v_order.package_title
        || ' paketinizi satın aldı. Lütfen en kısa sürede ilk görüşmenizi planlayın.'
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', 'paid',
    'enrollment_id', v_enrollment_id,
    'already_enrolled', v_already_enrolled,
    'wallet_ledger_id', v_wallet_ledger_id,
    'student_referral_credit_id', v_student_credit_id,
    'already_completed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) TO service_role;
