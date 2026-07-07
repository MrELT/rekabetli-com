-- Referral Faz 3: mentör davet komisyonu
-- supabase-referral-program-phase1.sql ve supabase-mentor-wallet-payout-hold.sql sonrasında çalıştırın.
--
-- Kurallar:
-- - Alıcı, aktif mentör attribution'ına sahipse (commission_until > now):
--   * Kendi mentöründen alım: platform komisyonu %15 (mentör net %85), ek satır yok
--   * Başka mentörden alım: satıcı mentör %80; davet eden mentör %5 affiliate; platform net %15
-- - referral_commission_rate() = %5, get_platform_commission_rate() = %20

ALTER TABLE public.mentor_wallet_ledger
DROP CONSTRAINT IF EXISTS mentor_wallet_ledger_entry_type_check;

ALTER TABLE public.mentor_wallet_ledger
ADD CONSTRAINT mentor_wallet_ledger_entry_type_check CHECK (
  entry_type IN (
    'package_sale',
    'payout',
    'refund',
    'adjustment',
    'referral_bonus',
    'referral_bonus_refund'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS mentor_wallet_ledger_referral_bonus_uidx
ON public.mentor_wallet_ledger (package_order_id, mentor_id)
WHERE entry_type = 'referral_bonus' AND package_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mentor_wallet_ledger_referral_bonus_refund_uidx
ON public.mentor_wallet_ledger (package_order_id, mentor_id)
WHERE entry_type = 'referral_bonus_refund' AND package_order_id IS NOT NULL;

ALTER TABLE public.package_orders
ADD COLUMN IF NOT EXISTS referral_commission_type text,
ADD COLUMN IF NOT EXISTS referral_payout_mentor_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS referral_payout_amount numeric(12, 2);

COMMENT ON COLUMN public.package_orders.referral_commission_type IS
  'mentor_own_audience | mentor_cross_sale | none';

CREATE OR REPLACE FUNCTION public.get_referral_reduced_platform_rate ()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT greatest(
    public.get_platform_commission_rate() - public.referral_commission_rate(),
    0
  )::numeric;
$$;

COMMENT ON FUNCTION public.get_referral_reduced_platform_rate () IS
  'Davet attribution''ı olan siparişlerde platform komisyon oranı (%15 = %20 − %5).';

CREATE OR REPLACE FUNCTION public.resolve_package_order_referral_commission (
  p_buyer_id uuid,
  p_seller_mentor_id uuid,
  p_gross numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attribution public.user_referral_attribution%ROWTYPE;
  v_gross numeric := round(greatest(coalesce(p_gross, 0), 0), 2);
  v_referral_type text := 'none';
  v_referral_mentor_id uuid;
  v_referral_amount numeric := 0;
  v_seller_platform_rate numeric := public.get_platform_commission_rate();
BEGIN
  IF p_buyer_id IS NULL OR p_seller_mentor_id IS NULL OR v_gross <= 0 THEN
    RETURN jsonb_build_object(
      'referral_type', 'none',
      'seller_platform_rate', v_seller_platform_rate,
      'referral_payout_mentor_id', NULL,
      'referral_payout_amount', 0
    );
  END IF;

  SELECT ura.*
  INTO v_attribution
  FROM public.user_referral_attribution AS ura
  WHERE ura.user_id = p_buyer_id
    AND ura.commission_until > now();

  IF NOT FOUND OR v_attribution.referrer_type <> 'mentor' THEN
    RETURN jsonb_build_object(
      'referral_type', 'none',
      'seller_platform_rate', v_seller_platform_rate,
      'referral_payout_mentor_id', NULL,
      'referral_payout_amount', 0
    );
  END IF;

  v_referral_mentor_id := v_attribution.referrer_user_id;

  IF v_referral_mentor_id = p_seller_mentor_id THEN
    v_referral_type := 'mentor_own_audience';
    v_seller_platform_rate := public.get_referral_reduced_platform_rate();
  ELSE
    v_referral_type := 'mentor_cross_sale';
    v_referral_amount := round(v_gross * public.referral_commission_rate(), 2);
  END IF;

  RETURN jsonb_build_object(
    'referral_type', v_referral_type,
    'seller_platform_rate', v_seller_platform_rate,
    'referral_payout_mentor_id', v_referral_mentor_id,
    'referral_payout_amount', v_referral_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_package_order_referral_commission (uuid, uuid, numeric) FROM PUBLIC;

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
  'Mentör net = brüt − platform komisyonu. İkinci parametre verilirse o oran kullanılır (davet indirimi).';

CREATE OR REPLACE FUNCTION public.record_mentor_referral_wallet_bonus (p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_resolution jsonb;
  v_referrer_id uuid;
  v_bonus numeric;
  v_student_name text;
  v_seller_label text;
  v_ledger_id uuid;
  v_title text;
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

  v_resolution := public.resolve_package_order_referral_commission(
    v_order.user_id,
    v_order.mentor_id,
    round(coalesce(v_order.amount_paid, v_order.list_price), 2)
  );

  UPDATE public.package_orders
  SET referral_commission_type = v_resolution ->> 'referral_type',
      referral_payout_mentor_id = NULLIF(v_resolution ->> 'referral_payout_mentor_id', '')::uuid,
      referral_payout_amount = coalesce((v_resolution ->> 'referral_payout_amount')::numeric, 0),
      updated_at = now()
  WHERE id = v_order.id;

  IF (v_resolution ->> 'referral_type') <> 'mentor_cross_sale' THEN
    RETURN NULL;
  END IF;

  v_referrer_id := NULLIF(v_resolution ->> 'referral_payout_mentor_id', '')::uuid;
  v_bonus := coalesce((v_resolution ->> 'referral_payout_amount')::numeric, 0);

  IF v_referrer_id IS NULL OR v_bonus <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT id
  INTO v_ledger_id
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.package_order_id = p_order_id
    AND mwl.entry_type = 'referral_bonus'
    AND mwl.mentor_id = v_referrer_id
  LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    RETURN v_ledger_id;
  END IF;

  v_student_name := coalesce(public.notification_actor_label(v_order.user_id), 'Öğrenci');
  v_seller_label := coalesce(public.notification_actor_label(v_order.mentor_id), 'Mentör');
  v_title := 'Davet komisyonu · ' || v_order.package_title;

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
    v_referrer_id,
    v_order.id,
    'referral_bonus',
    v_bonus,
    0,
    0,
    v_bonus,
    lower(trim(v_order.currency)),
    v_title,
    v_student_name || ' · ' || v_seller_label
  )
  RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_mentor_referral_wallet_bonus (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mentor_referral_wallet_bonus (uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_mentor_wallet_sale (p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_resolution jsonb;
  v_fees record;
  v_student_name text;
  v_ledger_id uuid;
  v_gross numeric;
  v_platform_rate numeric;
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

  v_gross := round(coalesce(v_order.amount_paid, v_order.list_price), 2);

  v_resolution := public.resolve_package_order_referral_commission(
    v_order.user_id,
    v_order.mentor_id,
    v_gross
  );
  v_platform_rate := coalesce(
    (v_resolution ->> 'seller_platform_rate')::numeric,
    public.get_platform_commission_rate()
  );

  SELECT *
  INTO v_fees
  FROM public.calculate_package_sale_fees(v_gross, v_platform_rate) AS f;

  SELECT id
  INTO v_ledger_id
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.package_order_id = p_order_id
    AND mwl.entry_type = 'package_sale'
  LIMIT 1;

  v_student_name := coalesce(public.notification_actor_label(v_order.user_id), 'Öğrenci');

  IF v_ledger_id IS NOT NULL THEN
    UPDATE public.mentor_wallet_ledger AS mwl
    SET gross_amount = v_fees.gross_amount,
        platform_fee = v_fees.platform_fee,
        stripe_fee = v_fees.stripe_fee,
        net_amount = v_fees.net_amount
    WHERE mwl.id = v_ledger_id;
  ELSE
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
  END IF;

  UPDATE public.package_orders
  SET platform_fee = v_fees.platform_fee,
      stripe_fee = v_fees.stripe_fee,
      referral_commission_type = v_resolution ->> 'referral_type',
      referral_payout_mentor_id = CASE
        WHEN (v_resolution ->> 'referral_type') = 'mentor_cross_sale'
          THEN NULLIF(v_resolution ->> 'referral_payout_mentor_id', '')::uuid
        ELSE NULL
      END,
      referral_payout_amount = CASE
        WHEN (v_resolution ->> 'referral_type') = 'mentor_cross_sale'
          THEN coalesce((v_resolution ->> 'referral_payout_amount')::numeric, 0)
        ELSE 0
      END,
      updated_at = now()
  WHERE id = v_order.id;

  PERFORM public.record_mentor_referral_wallet_bonus(p_order_id);

  RETURN v_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_mentor_wallet_sale (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mentor_wallet_sale (uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_mentor_referral_wallet_bonus_refund (p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bonus public.mentor_wallet_ledger%ROWTYPE;
  v_ledger_id uuid;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_bonus
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.package_order_id = p_order_id
    AND mwl.entry_type = 'referral_bonus'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT id
  INTO v_ledger_id
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.package_order_id = p_order_id
    AND mwl.entry_type = 'referral_bonus_refund'
    AND mwl.mentor_id = v_bonus.mentor_id
  LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    RETURN v_ledger_id;
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
    v_bonus.mentor_id,
    p_order_id,
    'referral_bonus_refund',
    -v_bonus.gross_amount,
    0,
    0,
    -v_bonus.net_amount,
    v_bonus.currency,
    v_bonus.package_title,
    v_bonus.student_display_name
  )
  RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_mentor_referral_wallet_bonus_refund (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mentor_referral_wallet_bonus_refund (uuid) TO service_role;

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
    PERFORM public.record_mentor_referral_wallet_bonus_refund(p_order_id);
    RETURN v_ledger_id;
  END IF;

  SELECT *
  INTO v_sale
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.package_order_id = p_order_id
    AND mwl.entry_type = 'package_sale'
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.record_mentor_referral_wallet_bonus_refund(p_order_id);
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

  PERFORM public.record_mentor_referral_wallet_bonus_refund(p_order_id);

  RETURN v_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_mentor_wallet_refund (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mentor_wallet_refund (uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.is_mentor_wallet_entry_withdrawable (
  p_entry_type text,
  p_package_order_id uuid,
  p_created_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN p_entry_type IN ('package_sale', 'referral_bonus') THEN
        coalesce(
          public.mentor_wallet_sale_withdrawable_at(p_package_order_id, p_created_at) <= now(),
          false
        )
      ELSE true
    END;
$$;

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
  v_held_balance numeric;
  v_hold_days integer;
  v_total_gross numeric;
  v_total_platform_fee numeric;
  v_total_stripe_fee numeric;
  v_total_net numeric;
  v_referral_bonus_total numeric;
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

  v_hold_days := public.get_mentor_payout_hold_days();
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

  SELECT coalesce(sum(mwl.net_amount), 0)
  INTO v_referral_bonus_total
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.mentor_id = v_mentor_id
    AND mwl.entry_type = 'referral_bonus';

  SELECT coalesce(sum(mwl.net_amount), 0)
  INTO v_held_balance
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.mentor_id = v_mentor_id
    AND mwl.entry_type IN ('package_sale', 'referral_bonus')
    AND NOT public.is_mentor_wallet_entry_withdrawable(
      mwl.entry_type,
      mwl.package_order_id,
      mwl.created_at
    );

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
      mwl.created_at,
      public.is_mentor_wallet_entry_withdrawable(
        mwl.entry_type,
        mwl.package_order_id,
        mwl.created_at
      ) AS is_withdrawable,
      CASE
        WHEN mwl.entry_type IN ('package_sale', 'referral_bonus') THEN
          public.mentor_wallet_sale_withdrawable_at(mwl.package_order_id, mwl.created_at)
        ELSE NULL
      END AS withdrawable_at
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
    'held_balance', v_held_balance,
    'payout_hold_days', v_hold_days,
    'total_gross', v_total_gross,
    'total_platform_fee', v_total_platform_fee,
    'total_net', v_total_net,
    'referral_bonus_total', v_referral_bonus_total,
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

-- Mevcut ödenmiş siparişlerde komisyonları yeniden hesapla
DO $$
DECLARE
  v_order_id uuid;
BEGIN
  FOR v_order_id IN
    SELECT po.id
    FROM public.package_orders AS po
    WHERE po.status = 'paid'
    ORDER BY po.paid_at NULLS LAST, po.created_at
  LOOP
    PERFORM public.record_mentor_wallet_sale(v_order_id);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.record_mentor_referral_wallet_bonus (uuid) IS
  'Başka mentörden yapılan alımlarda davet eden mentöre %5 affiliate (davet komisyonu) yazar.';

COMMENT ON FUNCTION public.resolve_package_order_referral_commission (uuid, uuid, numeric) IS
  'Sipariş için mentör davet komisyonu türünü ve satıcı platform oranını döner.';
