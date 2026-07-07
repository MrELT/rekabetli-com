-- Faz 7: Paket satın alma iadesi
-- supabase-package-orders.sql ve supabase-mentor-wallet.sql sonrasında çalıştırın.

ALTER TABLE public.package_orders
ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz,
ADD COLUMN IF NOT EXISTS refund_request_note text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
ADD COLUMN IF NOT EXISTS stripe_refund_id text,
ADD COLUMN IF NOT EXISTS refund_reason text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS package_orders_refund_requested_idx
ON public.package_orders (refund_requested_at DESC)
WHERE refund_requested_at IS NOT NULL AND status = 'paid';

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
    'mentor_package_purchased',
    'mentor_package_sale',
    'mentor_package_refund_requested',
    'mentor_package_refunded',
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
    'answer_reply'
  )
) NOT VALID;

CREATE OR REPLACE FUNCTION public.service_unenroll_student_from_package_order (p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
BEGIN
  SELECT *
  INTO v_order
  FROM public.package_orders AS po
  WHERE po.id = p_order_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  DELETE FROM public.mentor_package_students AS mps
  WHERE mps.mentor_id = v_order.mentor_id
    AND mps.student_id = v_order.user_id
    AND mps.package_id = v_order.package_id;
END;
$$;

REVOKE ALL ON FUNCTION public.service_unenroll_student_from_package_order (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.service_unenroll_student_from_package_order (uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_mentor_wallet_refund (p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_sale public.mentor_wallet_ledger%ROWTYPE;
  v_ledger_id uuid;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_order
  FROM public.package_orders AS po
  WHERE po.id = p_order_id;

  IF NOT FOUND OR v_order.status <> 'refunded' THEN
    RETURN NULL;
  END IF;

  SELECT id
  INTO v_ledger_id
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.package_order_id = p_order_id
    AND mwl.entry_type = 'refund'
  LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    RETURN v_ledger_id;
  END IF;

  SELECT *
  INTO v_sale
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.package_order_id = p_order_id
    AND mwl.entry_type = 'package_sale'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

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
    v_sale.mentor_id,
    p_order_id,
    'refund',
    -v_sale.gross_amount,
    -v_sale.platform_fee,
    0,
    -v_sale.net_amount,
    v_sale.currency,
    v_sale.package_title,
    v_sale.student_display_name
  )
  RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_mentor_wallet_refund (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mentor_wallet_refund (uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_package_refund (
  p_order_id uuid,
  p_stripe_refund_id text DEFAULT NULL,
  p_refund_reason text DEFAULT ''
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
      'already_refunded', true
    );
  END IF;

  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'package_order_not_refundable';
  END IF;

  PERFORM public.service_unenroll_student_from_package_order(v_order.id);

  UPDATE public.package_orders
  SET status = 'refunded',
      refunded_at = now(),
      stripe_refund_id = nullif(btrim(coalesce(p_stripe_refund_id, '')), ''),
      refund_reason = left(btrim(coalesce(p_refund_reason, '')), 500),
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
    v_order.package_title || ' paketi için iadeniz işlendi. Tutarın kartınıza yansıması 5–10 iş günü sürebilir.'
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
    'wallet_ledger_id', v_wallet_ledger_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_package_refund (uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_package_refund (uuid, text, text) TO service_role;

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
    v_order.user_id,
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
    'status', v_order.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_package_refund (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_package_refund (uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_package_order_for_enrollment (p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.package_orders%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT po.*
  INTO v_row
  FROM public.package_orders AS po
  WHERE po.enrollment_id = p_enrollment_id
    AND po.user_id = v_user_id
  ORDER BY po.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'package_title', v_row.package_title,
    'amount_paid', v_row.amount_paid,
    'paid_at', v_row.paid_at,
    'refund_requested_at', v_row.refund_requested_at,
    'refunded_at', v_row.refunded_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_package_order_for_enrollment (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_package_order_for_enrollment (uuid) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.get_admin_payout_queue ()
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
      SELECT jsonb_agg(row_to_json(q)::jsonb ORDER BY q.created_at DESC)
      FROM (
        SELECT
          mpr.id,
          mpr.mentor_id,
          mpr.amount_requested,
          mpr.transfer_fee,
          mpr.amount_net,
          mpr.status,
          mpr.failure_reason,
          mpr.wise_transfer_id,
          mpr.created_at,
          mpr.processed_at,
          coalesce(public.notification_actor_label(mpr.mentor_id), 'Mentör') AS mentor_name,
          mpa.account_holder,
          mpa.bank_name,
          mpa.iban
        FROM public.mentor_payout_requests AS mpr
        LEFT JOIN public.mentor_payout_accounts AS mpa ON mpa.user_id = mpr.mentor_id
        WHERE mpr.status IN ('pending', 'processing', 'completed', 'rejected')
        ORDER BY mpr.created_at DESC
        LIMIT 100
      ) AS q
    ),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_payout_queue () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_payout_queue () TO authenticated;
