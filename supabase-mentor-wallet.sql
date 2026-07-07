-- Mentör cüzdanı: paket satış geliri, komisyon kesintisi, ödeme talepleri
-- supabase-package-orders.sql ve supabase-mentor-payout-account.sql sonrasında çalıştırın.

-- Platform komisyonu (brüt tutar üzerinden). İleride admin ayarına taşınabilir.
CREATE OR REPLACE FUNCTION public.get_platform_commission_rate ()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 0.20::numeric;
$$;

CREATE OR REPLACE FUNCTION public.estimate_stripe_processing_fee (p_gross numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(greatest(p_gross, 0) * 0.029 + 1.99, 2);
$$;

CREATE OR REPLACE FUNCTION public.calculate_package_sale_fees (
  p_gross numeric,
  p_platform_commission_rate numeric DEFAULT NULL
)
RETURNS TABLE (
  gross_amount numeric,
  platform_fee numeric,
  stripe_fee numeric,
  net_amount numeric
)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH rate AS (
    SELECT coalesce(
      p_platform_commission_rate,
      public.get_platform_commission_rate()
    ) AS commission_rate
  )
  SELECT
    round(greatest(p_gross, 0), 2) AS gross_amount,
    round(greatest(p_gross, 0) * rate.commission_rate, 2) AS platform_fee,
    public.estimate_stripe_processing_fee(p_gross) AS stripe_fee,
    round(
      greatest(p_gross, 0) - (greatest(p_gross, 0) * rate.commission_rate),
      2
    ) AS net_amount
  FROM rate;
$$;

COMMENT ON FUNCTION public.calculate_package_sale_fees (numeric, numeric) IS
  'Mentör net = brüt − platform komisyonu. İkinci parametre verilirse o oran kullanılır.';

CREATE TABLE IF NOT EXISTS public.mentor_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  package_order_id uuid REFERENCES public.package_orders (id) ON DELETE SET NULL,
  entry_type text NOT NULL,
  gross_amount numeric(12, 2),
  platform_fee numeric(12, 2) NOT NULL DEFAULT 0,
  stripe_fee numeric(12, 2) NOT NULL DEFAULT 0,
  net_amount numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'try',
  package_title text NOT NULL DEFAULT '',
  student_display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_wallet_ledger_entry_type_check CHECK (
    entry_type IN ('package_sale', 'payout', 'refund', 'adjustment')
  ),
  CONSTRAINT mentor_wallet_ledger_net_nonzero CHECK (net_amount <> 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS mentor_wallet_ledger_sale_order_uidx
ON public.mentor_wallet_ledger (package_order_id)
WHERE entry_type = 'package_sale' AND package_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mentor_wallet_ledger_mentor_created_idx
ON public.mentor_wallet_ledger (mentor_id, created_at DESC);

ALTER TABLE public.mentor_wallet_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_wallet_ledger_select_mentor" ON public.mentor_wallet_ledger;
CREATE POLICY "mentor_wallet_ledger_select_mentor"
ON public.mentor_wallet_ledger
FOR SELECT
TO authenticated
USING (auth.uid () = mentor_id);

DROP POLICY IF EXISTS "mentor_wallet_ledger_select_admin" ON public.mentor_wallet_ledger;
CREATE POLICY "mentor_wallet_ledger_select_admin"
ON public.mentor_wallet_ledger
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

CREATE TABLE IF NOT EXISTS public.mentor_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  amount_requested numeric(12, 2) NOT NULL,
  transfer_fee numeric(12, 2) NOT NULL DEFAULT 0,
  amount_net numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'try',
  status text NOT NULL DEFAULT 'pending',
  mentor_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT mentor_payout_requests_amount_positive CHECK (amount_requested > 0),
  CONSTRAINT mentor_payout_requests_net_positive CHECK (amount_net > 0),
  CONSTRAINT mentor_payout_requests_status_check CHECK (
    status IN ('pending', 'processing', 'completed', 'rejected', 'canceled')
  )
);

CREATE INDEX IF NOT EXISTS mentor_payout_requests_mentor_created_idx
ON public.mentor_payout_requests (mentor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mentor_payout_requests_status_idx
ON public.mentor_payout_requests (status, created_at DESC);

ALTER TABLE public.mentor_payout_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_payout_requests_select_mentor" ON public.mentor_payout_requests;
CREATE POLICY "mentor_payout_requests_select_mentor"
ON public.mentor_payout_requests
FOR SELECT
TO authenticated
USING (auth.uid () = mentor_id);

DROP POLICY IF EXISTS "mentor_payout_requests_select_admin" ON public.mentor_payout_requests;
CREATE POLICY "mentor_payout_requests_select_admin"
ON public.mentor_payout_requests
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

CREATE OR REPLACE FUNCTION public.record_mentor_wallet_sale (p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_fees record;
  v_student_name text;
  v_ledger_id uuid;
  v_gross numeric;
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

  SELECT id
  INTO v_ledger_id
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.package_order_id = p_order_id
    AND mwl.entry_type = 'package_sale'
  LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    v_gross := round(coalesce(v_order.amount_paid, v_order.list_price), 2);

    SELECT *
    INTO v_fees
    FROM public.calculate_package_sale_fees(v_gross, NULL::numeric) AS f;

    UPDATE public.mentor_wallet_ledger AS mwl
    SET gross_amount = v_fees.gross_amount,
        platform_fee = v_fees.platform_fee,
        stripe_fee = v_fees.stripe_fee,
        net_amount = v_fees.net_amount
    WHERE mwl.id = v_ledger_id;

    UPDATE public.package_orders
    SET platform_fee = v_fees.platform_fee,
        stripe_fee = v_fees.stripe_fee,
        updated_at = now()
    WHERE id = v_order.id;

    RETURN v_ledger_id;
  END IF;

  v_gross := round(coalesce(v_order.amount_paid, v_order.list_price), 2);

  SELECT *
  INTO v_fees
  FROM public.calculate_package_sale_fees(v_gross, NULL::numeric) AS f;

  v_student_name := coalesce(public.notification_actor_label(v_order.user_id), 'Öğrenci');

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
    v_order.mentor_id,
    v_order.id,
    'package_sale',
    v_fees.gross_amount,
    v_fees.platform_fee,
    v_fees.stripe_fee,
    v_fees.net_amount,
    lower(trim(v_order.currency)),
    v_order.package_title,
    v_student_name
  )
  RETURNING id INTO v_ledger_id;

  UPDATE public.package_orders
  SET platform_fee = v_fees.platform_fee,
      stripe_fee = v_fees.stripe_fee,
      updated_at = now()
  WHERE id = v_order.id
    AND (platform_fee IS NULL OR stripe_fee IS NULL);

  RETURN v_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_mentor_wallet_sale (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mentor_wallet_sale (uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_mentor_wallet_available_balance (p_mentor_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT sum(mwl.net_amount)
      FROM public.mentor_wallet_ledger AS mwl
      WHERE mwl.mentor_id = p_mentor_id
    ),
    0
  ) - coalesce(
    (
      SELECT sum(mpr.amount_requested)
      FROM public.mentor_payout_requests AS mpr
      WHERE mpr.mentor_id = p_mentor_id
        AND mpr.status IN ('pending', 'processing')
    ),
    0
  );
$$;

REVOKE ALL ON FUNCTION public.get_mentor_wallet_available_balance (uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_mentor_wallet_summary ()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
  v_available numeric;
  v_total_gross numeric;
  v_total_platform_fee numeric;
  v_total_stripe_fee numeric;
  v_total_net numeric;
  v_sale_count integer;
  v_pending_payout numeric;
  v_commission_pct numeric;
  v_transactions jsonb;
  v_payout_requests jsonb;
BEGIN
  IF v_mentor_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = v_mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'mentor_required';
  END IF;

  v_commission_pct := round(public.get_platform_commission_rate() * 100, 2);

  SELECT
    coalesce(sum(mwl.gross_amount), 0),
    coalesce(sum(mwl.platform_fee), 0),
    coalesce(sum(mwl.stripe_fee), 0),
    coalesce(sum(mwl.net_amount), 0),
    count(*)::integer
  INTO v_total_gross, v_total_platform_fee, v_total_stripe_fee, v_total_net, v_sale_count
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.mentor_id = v_mentor_id
    AND mwl.entry_type = 'package_sale';

  SELECT coalesce(sum(mpr.amount_requested), 0)
  INTO v_pending_payout
  FROM public.mentor_payout_requests AS mpr
  WHERE mpr.mentor_id = v_mentor_id
    AND mpr.status IN ('pending', 'processing');

  v_available := public.get_mentor_wallet_available_balance(v_mentor_id);

  SELECT coalesce(jsonb_agg(row_to_json(tx)::jsonb ORDER BY tx.created_at DESC), '[]'::jsonb)
  INTO v_transactions
  FROM (
    SELECT
      mwl.id,
      mwl.entry_type,
      mwl.package_title,
      mwl.student_display_name,
      mwl.gross_amount,
      mwl.platform_fee,
      mwl.net_amount,
      mwl.currency,
      mwl.created_at
    FROM public.mentor_wallet_ledger AS mwl
    WHERE mwl.mentor_id = v_mentor_id
    ORDER BY mwl.created_at DESC
    LIMIT 50
  ) AS tx;

  SELECT coalesce(jsonb_agg(row_to_json(pr)::jsonb ORDER BY pr.created_at DESC), '[]'::jsonb)
  INTO v_payout_requests
  FROM (
    SELECT
      mpr.id,
      mpr.amount_requested,
      mpr.transfer_fee,
      mpr.amount_net,
      mpr.status,
      mpr.created_at,
      mpr.processed_at
    FROM public.mentor_payout_requests AS mpr
    WHERE mpr.mentor_id = v_mentor_id
    ORDER BY mpr.created_at DESC
    LIMIT 20
  ) AS pr;

  RETURN jsonb_build_object(
    'available_balance', v_available,
    'total_gross', v_total_gross,
    'total_platform_fee', v_total_platform_fee,
    'total_stripe_fee', v_total_stripe_fee,
    'total_net', v_total_net,
    'sale_count', v_sale_count,
    'pending_payout', v_pending_payout,
    'commission_rate_pct', v_commission_pct,
    'payment_fees_covered_by_platform', true,
    'payout_transfer_fee', 35,
    'transactions', v_transactions,
    'payout_requests', v_payout_requests
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mentor_wallet_summary () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_wallet_summary () TO authenticated;

CREATE OR REPLACE FUNCTION public.request_mentor_payout (
  p_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := auth.uid();
  v_available numeric;
  v_amount numeric;
  v_transfer_fee numeric;
  v_amount_net numeric;
  v_request_id uuid;
  v_transfer_fee_amount numeric := 35;
BEGIN
  IF v_mentor_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = v_mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'mentor_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_payout_accounts AS mpa
    WHERE mpa.user_id = v_mentor_id
  ) THEN
    RAISE EXCEPTION 'payout_account_required';
  END IF;

  v_available := public.get_mentor_wallet_available_balance(v_mentor_id);
  v_amount := round(coalesce(p_amount, v_available), 2);

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'payout_amount_invalid';
  END IF;

  IF v_amount > v_available THEN
    RAISE EXCEPTION 'payout_insufficient_balance';
  END IF;

  v_transfer_fee := v_transfer_fee_amount;

  v_amount_net := round(v_amount - v_transfer_fee, 2);

  IF v_amount_net <= 0 THEN
    RAISE EXCEPTION 'payout_amount_too_low_after_fee';
  END IF;

  INSERT INTO public.mentor_payout_requests (
    mentor_id,
    amount_requested,
    transfer_fee,
    amount_net,
    status
  )
  VALUES (
    v_mentor_id,
    v_amount,
    v_transfer_fee,
    v_amount_net,
    'pending'
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'amount_requested', v_amount,
    'transfer_fee', v_transfer_fee,
    'amount_net', v_amount_net,
    'status', 'pending',
    'available_balance', public.get_mentor_wallet_available_balance(v_mentor_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_mentor_payout (numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_mentor_payout (numeric) TO authenticated;

-- Mevcut ödenmiş siparişler için cüzdan kaydı oluştur (isteğe bağlı, tek seferlik):
-- DO $$
-- DECLARE
--   v_order_id uuid;
-- BEGIN
--   FOR v_order_id IN
--     SELECT po.id
--     FROM public.package_orders AS po
--     WHERE po.status = 'paid'
--     ORDER BY po.paid_at ASC NULLS LAST, po.created_at ASC
--   LOOP
--     PERFORM public.record_mentor_wallet_sale(v_order_id);
--   END LOOP;
-- END;
-- $$;

-- complete_package_purchase: ödeme sonrası cüzdan kaydı
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

-- Mevcut satışları yeniden hesaplamak için (isteğe bağlı, tek seferlik):
-- DO $$
-- DECLARE v_order_id uuid;
-- BEGIN
--   FOR v_order_id IN SELECT po.id FROM public.package_orders AS po WHERE po.status = 'paid'
--   LOOP
--     PERFORM public.record_mentor_wallet_sale(v_order_id);
--   END LOOP;
-- END;
-- $$;

COMMENT ON TABLE public.mentor_wallet_ledger IS
  'Mentör cüzdan hareketleri: paket satışı geliri, ödeme, iade.';

COMMENT ON TABLE public.mentor_payout_requests IS
  'Mentörün banka hesabına ödeme talepleri (manuel işlem).';
