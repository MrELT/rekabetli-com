-- Öğrenci davet indirim bakiyesi (%5): görünür, ödemede otomatik düşülür
-- supabase-referral-program-phase1-fix.sql, supabase-package-orders-renewal.sql,
-- supabase-package-purchase-notifications.sql sonrasında çalıştırın.

ALTER TABLE public.package_orders
ADD COLUMN IF NOT EXISTS referral_credit_applied numeric(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.package_orders.referral_credit_applied IS
  'Bu siparişte kullanılan öğrenci davet indirim bakiyesi (TRY).';

CREATE TABLE IF NOT EXISTS public.student_referral_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  source_order_id uuid NOT NULL REFERENCES public.package_orders (id) ON DELETE CASCADE,
  buyer_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  gross_basis numeric(12, 2) NOT NULL CHECK (gross_basis > 0),
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reserved', 'used', 'revoked')),
  reserved_order_id uuid REFERENCES public.package_orders (id) ON DELETE SET NULL,
  used_order_id uuid REFERENCES public.package_orders (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_referral_credits_source_order_idx
ON public.student_referral_credits (source_order_id);

CREATE INDEX IF NOT EXISTS student_referral_credits_student_created_idx
ON public.student_referral_credits (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS student_referral_credits_reserved_order_idx
ON public.student_referral_credits (reserved_order_id)
WHERE reserved_order_id IS NOT NULL;

COMMENT ON TABLE public.student_referral_credits IS
  'Öğrenci davet komisyonu (%5) indirim bakiyesi. Görüşme + 14 gün sonra kullanılabilir.';

ALTER TABLE public.student_referral_credits
DROP CONSTRAINT IF EXISTS student_referral_credits_source_order_uidx;

DROP INDEX IF EXISTS public.student_referral_credits_source_order_initial_uidx;

ALTER TABLE public.student_referral_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_referral_credits_select_own" ON public.student_referral_credits;
CREATE POLICY "student_referral_credits_select_own"
ON public.student_referral_credits
FOR SELECT
TO authenticated
USING (auth.uid () = student_id);

CREATE OR REPLACE FUNCTION public.student_referral_credit_phase (
  p_credit public.student_referral_credits
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN p_credit.status = 'revoked' THEN 'revoked'
      WHEN p_credit.status = 'used' THEN 'used'
      WHEN p_credit.status = 'reserved' THEN 'reserved'
      WHEN public.get_package_order_first_meeting_at(p_credit.source_order_id) IS NULL THEN 'pending_meeting'
      WHEN public.mentor_wallet_sale_withdrawable_at(
        p_credit.source_order_id,
        p_credit.created_at
      ) > now() THEN 'pending_hold'
      ELSE 'available'
    END;
$$;

CREATE OR REPLACE FUNCTION public.student_referral_credit_activates_at (
  p_source_order_id uuid,
  p_created_at timestamptz
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.mentor_wallet_sale_withdrawable_at(p_source_order_id, p_created_at);
$$;

CREATE OR REPLACE FUNCTION public.get_student_referral_credit_available_balance (p_student_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(src.amount), 0)
  FROM public.student_referral_credits AS src
  WHERE src.student_id = p_student_id
    AND src.status = 'open'
    AND public.student_referral_credit_phase(src) = 'available';
$$;

CREATE OR REPLACE FUNCTION public.release_student_referral_credit_reservations (p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.student_referral_credits AS src
  SET status = 'open',
      reserved_order_id = NULL,
      updated_at = now()
  WHERE src.reserved_order_id = p_order_id
    AND src.status = 'reserved';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_student_referral_credits (
  p_student_id uuid,
  p_order_id uuid,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  v_reserved numeric := 0;
  v_remaining numeric;
  v_credit public.student_referral_credits%ROWTYPE;
  v_use_amount numeric;
  v_split_id uuid;
BEGIN
  IF p_student_id IS NULL OR p_order_id IS NULL OR v_target <= 0 THEN
    RETURN 0;
  END IF;

  PERFORM public.release_student_referral_credit_reservations(p_order_id);

  v_remaining := v_target;

  FOR v_credit IN
    SELECT src.*
    FROM public.student_referral_credits AS src
    WHERE src.student_id = p_student_id
      AND src.status = 'open'
      AND public.student_referral_credit_phase(src) = 'available'
    ORDER BY public.student_referral_credit_activates_at(src.source_order_id, src.created_at) ASC NULLS LAST,
      src.created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_use_amount := least(v_credit.amount, v_remaining);

    IF v_use_amount < v_credit.amount THEN
      INSERT INTO public.student_referral_credits (
        student_id,
        source_order_id,
        buyer_user_id,
        gross_basis,
        amount,
        status
      )
      VALUES (
        v_credit.student_id,
        v_credit.source_order_id,
        v_credit.buyer_user_id,
        v_credit.gross_basis,
        round(v_credit.amount - v_use_amount, 2),
        'open'
      )
      RETURNING id INTO v_split_id;
    END IF;

    UPDATE public.student_referral_credits AS src
    SET amount = v_use_amount,
        status = 'reserved',
        reserved_order_id = p_order_id,
        updated_at = now()
    WHERE src.id = v_credit.id;

    v_reserved := v_reserved + v_use_amount;
    v_remaining := round(v_remaining - v_use_amount, 2);
  END LOOP;

  RETURN round(v_reserved, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_student_referral_credits_for_order (p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.student_referral_credits AS src
  SET status = 'used',
      used_order_id = p_order_id,
      reserved_order_id = NULL,
      updated_at = now()
  WHERE src.reserved_order_id = p_order_id
    AND src.status = 'reserved';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_student_referral_credit (p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_attribution public.user_referral_attribution%ROWTYPE;
  v_amount numeric;
  v_credit_id uuid;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_order
  FROM public.package_orders AS po
  WHERE po.id = p_order_id;

  IF NOT FOUND OR v_order.status <> 'paid' THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_attribution
  FROM public.user_referral_attribution AS ura
  WHERE ura.user_id = v_order.user_id
    AND ura.referrer_type = 'student'
    AND ura.commission_until > coalesce(v_order.paid_at, v_order.created_at);

  IF NOT FOUND OR v_attribution.referrer_user_id = v_order.user_id THEN
    RETURN NULL;
  END IF;

  SELECT id
  INTO v_credit_id
  FROM public.student_referral_credits AS src
  WHERE src.source_order_id = p_order_id
  LIMIT 1;

  IF v_credit_id IS NOT NULL THEN
    RETURN v_credit_id;
  END IF;

  v_amount := round(v_order.list_price * public.referral_commission_rate(), 2);
  IF v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.student_referral_credits (
    student_id,
    source_order_id,
    buyer_user_id,
    gross_basis,
    amount
  )
  VALUES (
    v_attribution.referrer_user_id,
    v_order.id,
    v_order.user_id,
    round(v_order.list_price, 2),
    v_amount
  )
  RETURNING id INTO v_credit_id;

  RETURN v_credit_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_student_referral_credit (p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.student_referral_credits AS src
  SET status = 'revoked',
      reserved_order_id = NULL,
      updated_at = now()
  WHERE src.source_order_id = p_order_id
    AND src.status IN ('open', 'reserved');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_student_referral_wallet ()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_available numeric := 0;
  v_pending_meeting numeric := 0;
  v_pending_hold numeric := 0;
  v_used_total numeric := 0;
  v_items jsonb;
BEGIN
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT
    coalesce(sum(CASE WHEN public.student_referral_credit_phase(src) = 'available' AND src.status = 'open' THEN src.amount ELSE 0 END), 0),
    coalesce(sum(CASE WHEN public.student_referral_credit_phase(src) = 'pending_meeting' THEN src.amount ELSE 0 END), 0),
    coalesce(sum(CASE WHEN public.student_referral_credit_phase(src) = 'pending_hold' THEN src.amount ELSE 0 END), 0),
    coalesce(sum(CASE WHEN src.status = 'used' THEN src.amount ELSE 0 END), 0)
  INTO v_available, v_pending_meeting, v_pending_hold, v_used_total
  FROM public.student_referral_credits AS src
  WHERE src.student_id = v_student_id
    AND src.status <> 'revoked';

  SELECT coalesce(jsonb_agg(row_to_json(item)::jsonb ORDER BY item.sort_at DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      src.id,
      src.amount,
      src.status,
      public.student_referral_credit_phase(src) AS phase,
      src.source_order_id,
      src.used_order_id,
      src.created_at,
      coalesce(
        public.student_referral_credit_activates_at(src.source_order_id, src.created_at),
        src.created_at
      ) AS activates_at,
      coalesce(public.notification_actor_label(src.buyer_user_id), 'Öğrenci') AS buyer_name,
      po.package_title,
      coalesce(po.paid_at, po.created_at) AS sort_at
    FROM public.student_referral_credits AS src
    INNER JOIN public.package_orders AS po ON po.id = src.source_order_id
    WHERE src.student_id = v_student_id
      AND src.status <> 'revoked'
    ORDER BY coalesce(po.paid_at, po.created_at) DESC
    LIMIT 30
  ) AS item;

  RETURN jsonb_build_object(
    'available_balance', round(v_available, 2),
    'pending_meeting_balance', round(v_pending_meeting, 2),
    'pending_hold_balance', round(v_pending_hold, 2),
    'used_total', round(v_used_total, 2),
    'commission_rate_pct', round(public.referral_commission_rate() * 100, 2),
    'hold_days', public.get_mentor_payout_hold_days(),
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_referral_credit_phase (public.student_referral_credits) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_referral_credit_activates_at (uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_referral_credit_available_balance (uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_student_referral_credit_reservations (uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_student_referral_credits (uuid, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_student_referral_credits_for_order (uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_student_referral_credit (uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_student_referral_credit (uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_student_referral_wallet () FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_student_referral_wallet () TO authenticated;

GRANT EXECUTE ON FUNCTION public.release_student_referral_credit_reservations (uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_student_referral_credits (uuid, uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_student_referral_credits_for_order (uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_student_referral_credit (uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_student_referral_credit (uuid) TO service_role;

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

  v_student_label := coalesce(public.notification_actor_label(v_order.user_id), 'Öğrenci');
  v_mentor_label := coalesce(public.notification_actor_label(v_order.mentor_id), 'Mentör');

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', 'paid',
    'enrollment_id', v_enrollment_id,
    'already_enrolled', v_already_enrolled,
    'wallet_ledger_id', v_wallet_ledger_id,
    'student_referral_credit_id', v_student_credit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) TO service_role;

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
  PERFORM public.revoke_student_referral_credit(v_order.id);

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
      coalesce(po.referral_credit_applied, 0) AS referral_credit_applied,
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
