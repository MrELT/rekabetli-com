-- Güvenlik: H1 transfer ücreti bypass, H3 iade tutarı IDOR, H4 profil PII
-- supabase-security-payout-race-fix.sql sonrasında çalıştırın.

-- ---------------------------------------------------------------------------
-- H1: Ödeme talebi RPC'leri yalnızca service_role (edge function) üzerinden
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.request_mentor_payout (numeric, boolean, numeric, text);
DROP FUNCTION IF EXISTS public.request_influencer_payout (numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.request_mentor_payout (
  p_mentor_id uuid,
  p_amount numeric DEFAULT NULL,
  p_self_billing_agreed boolean DEFAULT false,
  p_transfer_fee numeric DEFAULT NULL,
  p_wise_quote_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_id uuid := p_mentor_id;
  v_available numeric;
  v_amount numeric;
  v_transfer_fee numeric;
  v_amount_net numeric;
  v_request_id uuid;
  v_quote_id text := nullif(btrim(coalesce(p_wise_quote_id, '')), '');
  v_min_transfer_fee numeric := 35;
BEGIN
  IF v_mentor_id IS NULL THEN
    RAISE EXCEPTION 'mentor_id_required';
  END IF;

  IF NOT coalesce(p_self_billing_agreed, false) THEN
    RAISE EXCEPTION 'self_billing_agreement_required';
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

  IF p_transfer_fee IS NULL OR p_transfer_fee < v_min_transfer_fee THEN
    RAISE EXCEPTION 'transfer_fee_invalid';
  END IF;

  v_transfer_fee := round(p_transfer_fee, 2);

  PERFORM pg_advisory_xact_lock(hashtext('mentor_payout:' || v_mentor_id::text));

  IF EXISTS (
    SELECT 1
    FROM public.mentor_payout_requests AS mpr
    WHERE mpr.mentor_id = v_mentor_id
      AND mpr.status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'payout_request_already_active';
  END IF;

  v_available := public.get_mentor_wallet_available_balance(v_mentor_id);
  v_amount := round(coalesce(p_amount, v_available), 2);

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'payout_amount_invalid';
  END IF;

  IF v_amount > v_available THEN
    RAISE EXCEPTION 'payout_insufficient_balance';
  END IF;

  IF v_transfer_fee > greatest(v_amount * 0.15, 2500) THEN
    RAISE EXCEPTION 'transfer_fee_invalid';
  END IF;

  v_amount_net := round(v_amount - v_transfer_fee, 2);

  IF v_amount_net <= 0 THEN
    RAISE EXCEPTION 'payout_amount_too_low_after_fee';
  END IF;

  INSERT INTO public.mentor_payout_requests (
    mentor_id,
    amount_requested,
    transfer_fee,
    amount_net,
    status,
    self_billing_agreed_at,
    wise_quote_id
  )
  VALUES (
    v_mentor_id,
    v_amount,
    v_transfer_fee,
    v_amount_net,
    'pending',
    now(),
    v_quote_id
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'amount_requested', v_amount,
    'transfer_fee', v_transfer_fee,
    'amount_net', v_amount_net,
    'status', 'pending',
    'wise_quote_id', v_quote_id,
    'self_billing_agreed_at', now(),
    'available_balance', public.get_mentor_wallet_available_balance(v_mentor_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_influencer_payout (
  p_influencer_id uuid,
  p_amount numeric DEFAULT NULL,
  p_transfer_fee numeric DEFAULT NULL,
  p_wise_quote_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := p_influencer_id;
  v_available numeric;
  v_amount numeric;
  v_transfer_fee numeric;
  v_amount_net numeric;
  v_request_id uuid;
  v_min_amount numeric := 500;
  v_min_transfer_fee numeric := 35;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'influencer_id_required';
  END IF;

  IF NOT public.is_influencer_approved(v_user_id) THEN
    RAISE EXCEPTION 'influencer_not_approved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.influencer_payout_accounts AS ipa
    WHERE ipa.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'payout_account_required';
  END IF;

  IF p_transfer_fee IS NULL OR p_transfer_fee < v_min_transfer_fee THEN
    RAISE EXCEPTION 'transfer_fee_invalid';
  END IF;

  v_transfer_fee := round(p_transfer_fee, 2);

  PERFORM pg_advisory_xact_lock(hashtext('influencer_payout:' || v_user_id::text));

  IF EXISTS (
    SELECT 1
    FROM public.influencer_payout_requests AS ipr
    WHERE ipr.influencer_id = v_user_id
      AND ipr.status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'payout_request_already_active';
  END IF;

  v_available := public.get_influencer_wallet_available_balance(v_user_id);
  v_amount := round(coalesce(p_amount, v_available), 2);

  IF v_amount < v_min_amount THEN
    RAISE EXCEPTION 'payout_amount_below_minimum';
  END IF;

  IF v_amount > v_available THEN
    RAISE EXCEPTION 'payout_insufficient_balance';
  END IF;

  v_amount_net := round(v_amount - v_transfer_fee, 2);

  IF v_amount_net <= 0 THEN
    RAISE EXCEPTION 'payout_amount_too_low_after_fee';
  END IF;

  INSERT INTO public.influencer_payout_requests (
    influencer_id,
    amount_requested,
    transfer_fee,
    amount_net,
    wise_quote_id,
    status
  )
  VALUES (
    v_user_id,
    v_amount,
    v_transfer_fee,
    v_amount_net,
    nullif(btrim(coalesce(p_wise_quote_id, '')), ''),
    'pending'
  )
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'amount_requested', v_amount,
    'transfer_fee', v_transfer_fee,
    'amount_net', v_amount_net,
    'status', 'pending'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_mentor_payout (uuid, numeric, boolean, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_mentor_payout (uuid, numeric, boolean, numeric, text) TO service_role;

REVOKE ALL ON FUNCTION public.request_influencer_payout (uuid, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_influencer_payout (uuid, numeric, numeric, text) TO service_role;

-- ---------------------------------------------------------------------------
-- H3: İade tutarı RPC — yalnızca sipariş sahibi, mentör veya admin
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_package_refund_amounts (p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_calc record;
  v_caller uuid := auth.uid();
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'package_order_invalid';
  END IF;

  SELECT *
  INTO v_order
  FROM public.package_orders AS po
  WHERE po.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_order_not_found';
  END IF;

  IF v_caller IS NOT NULL
    AND NOT public.is_admin_user(v_caller)
    AND v_order.user_id <> v_caller
    AND v_order.mentor_id <> v_caller THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT *
  INTO v_calc
  FROM public.calculate_package_student_refund(
    coalesce(v_order.amount_paid, v_order.list_price),
    v_order.stripe_fee
  ) AS c;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'amount_paid', v_calc.gross_amount,
    'stripe_fee_retained', v_calc.stripe_fee_retained,
    'refund_amount', v_calc.refund_amount,
    'currency', v_order.currency
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_package_refund_amounts (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_package_refund_amounts (uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- H4: Profil PII — sütun düzeyinde erişim + is_mentor koruması
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "profiles_select_public" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own_sensitive" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;

GRANT SELECT (
  id,
  display_name,
  avatar_url,
  bio,
  city,
  school,
  user_type,
  is_mentor,
  user_code,
  answer_rating_sum,
  answer_rating_count,
  created_at,
  updated_at
) ON public.profiles TO anon, authenticated;

GRANT SELECT (
  email,
  phone
) ON public.profiles TO authenticated;

GRANT INSERT, UPDATE ON public.profiles TO authenticated;

CREATE POLICY "profiles_select_public"
ON public.profiles
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "profiles_select_own_sensitive"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid () = id);

CREATE POLICY "profiles_select_admin"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid () = id);

CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid () = id)
WITH CHECK (auth.uid () = id);

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_mentor IS DISTINCT FROM OLD.is_mentor
    AND NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION 'profile_field_protected';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_privileged_columns ON public.profiles;

CREATE TRIGGER profiles_protect_privileged_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_privileged_columns ();
