-- Paket satın alma bildirimleri: enrollment_id + güncellenmiş metinler
-- supabase-referral-program-phase3-mentor-commission.sql sonrasında bir kez çalıştırın.
--
-- Not: referral fazında calculate_package_sale_fees(numeric, numeric) tanımlanır.
-- Eski tek parametreli sürüm kalırsa "function is not unique" hatası verir.

DROP FUNCTION IF EXISTS public.calculate_package_sale_fees(numeric);

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (
  type IN (
    'comment',
    'like',
    'community_join_request',
    'community_join_rejected',
    'community_post',
    'mentor_package_request',
    'mentor_student_message',
    'mentor_mentor_reply',
    'mentor_meeting_proposal',
    'mentor_meeting_confirmed',
    'mentor_meeting_postpone',
    'mentor_meeting_postpone_accepted',
    'mentor_meeting_refund_requested',
    'mentor_meeting_reminder_1d',
    'mentor_meeting_reminder_30m',
    'mentor_vitrin_active',
    'answer_reply',
    'mentor_package_purchased',
    'mentor_package_sale',
    'mentor_package_refund_requested',
    'mentor_package_refunded'
  )
) NOT VALID;

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

  v_gross := round(coalesce(p_amount_paid, v_order.list_price), 2);

  UPDATE public.package_orders
  SET status = 'paid',
      amount_paid = v_gross,
      stripe_checkout_session_id = COALESCE(v_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = COALESCE(v_payment_intent_id, stripe_payment_intent_id),
      enrollment_id = v_enrollment_id,
      paid_at = now(),
      updated_at = now()
  WHERE id = v_order.id;

  -- platform_fee / stripe_fee / referral alanları record_mentor_wallet_sale içinde hesaplanır
  v_wallet_ledger_id := public.record_mentor_wallet_sale(v_order.id);

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
      v_order.user_id,
      v_order.mentor_id,
      v_mentor_label,
      'mentor_package_purchased',
      v_order.mentor_id,
      v_enrollment_id,
      v_mentor_label || ' · ' || v_order.package_title
        || ' paketini satın aldınız. Danışman panelinizden mentörünüzle iletişime geçebilir ve ilk görüşme zamanınızı planlayabilirsiniz.'
    );

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
    'wallet_ledger_id', v_wallet_ledger_id,
    'already_completed', false,
    'already_enrolled', v_already_enrolled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) TO service_role;
