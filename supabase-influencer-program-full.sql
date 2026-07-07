-- Rekabetli Influencer Programı — başvuru, komisyon, cüzdan, ödeme
-- Ön koşul: supabase-referral-program-phase1.sql, phase3-mentor-commission.sql,
--            supabase-mentor-payout-wise.sql

-- ---------------------------------------------------------------------------
-- Başvuru alanları
-- ---------------------------------------------------------------------------

ALTER TABLE public.influencer_profiles
ADD COLUMN IF NOT EXISTS social_platform text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS social_handle text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS follower_range text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS application_note text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS website_url text NOT NULL DEFAULT '';

ALTER TABLE public.package_orders
ADD COLUMN IF NOT EXISTS referral_payout_influencer_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS referral_influencer_commission_amount numeric(12, 2);

-- ---------------------------------------------------------------------------
-- Influencer cüzdanı
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.influencer_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  package_order_id uuid REFERENCES public.package_orders (id) ON DELETE SET NULL,
  entry_type text NOT NULL,
  gross_amount numeric(12, 2),
  net_amount numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'try',
  package_title text,
  buyer_display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT influencer_wallet_ledger_entry_type_check CHECK (
    entry_type IN ('referral_commission', 'referral_commission_refund', 'payout', 'adjustment')
  )
);

CREATE INDEX IF NOT EXISTS influencer_wallet_ledger_influencer_created_idx
ON public.influencer_wallet_ledger (influencer_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS influencer_wallet_ledger_order_type_uidx
ON public.influencer_wallet_ledger (package_order_id, entry_type)
WHERE package_order_id IS NOT NULL
  AND entry_type IN ('referral_commission', 'referral_commission_refund');

ALTER TABLE public.influencer_wallet_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "influencer_wallet_ledger_select_own" ON public.influencer_wallet_ledger;
CREATE POLICY "influencer_wallet_ledger_select_own"
ON public.influencer_wallet_ledger
FOR SELECT
TO authenticated
USING (auth.uid () = influencer_id OR public.is_admin_user (auth.uid ()));

CREATE TABLE IF NOT EXISTS public.influencer_payout_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  account_holder text NOT NULL,
  bank_name text NOT NULL,
  iban text NOT NULL,
  wise_recipient_id bigint,
  wise_recipient_iban text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT influencer_payout_account_holder_len CHECK (
    char_length(trim(account_holder)) BETWEEN 3 AND 120
  ),
  CONSTRAINT influencer_payout_bank_name_len CHECK (
    char_length(trim(bank_name)) BETWEEN 2 AND 80
  ),
  CONSTRAINT influencer_payout_iban_len CHECK (char_length(iban) = 26),
  CONSTRAINT influencer_payout_iban_format CHECK (iban ~ '^TR[0-9]{24}$')
);

ALTER TABLE public.influencer_payout_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "influencer_payout_select_own" ON public.influencer_payout_accounts;
CREATE POLICY "influencer_payout_select_own"
ON public.influencer_payout_accounts
FOR SELECT
TO authenticated
USING (auth.uid () = user_id OR public.is_admin_user (auth.uid ()));

DROP POLICY IF EXISTS "influencer_payout_upsert_own" ON public.influencer_payout_accounts;
CREATE POLICY "influencer_payout_upsert_own"
ON public.influencer_payout_accounts
FOR ALL
TO authenticated
USING (
  auth.uid () = user_id
  AND EXISTS (
    SELECT 1
    FROM public.influencer_profiles AS ip
    WHERE ip.user_id = auth.uid ()
      AND ip.status = 'approved'
  )
)
WITH CHECK (
  auth.uid () = user_id
  AND EXISTS (
    SELECT 1
    FROM public.influencer_profiles AS ip
    WHERE ip.user_id = auth.uid ()
      AND ip.status = 'approved'
  )
);

CREATE TABLE IF NOT EXISTS public.influencer_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  amount_requested numeric(12, 2) NOT NULL,
  transfer_fee numeric(12, 2) NOT NULL DEFAULT 35,
  amount_net numeric(12, 2) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  wise_transfer_id bigint,
  wise_quote_id text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT influencer_payout_requests_amount_positive CHECK (amount_requested > 0),
  CONSTRAINT influencer_payout_requests_status_check CHECK (
    status IN ('pending', 'processing', 'completed', 'rejected', 'canceled')
  )
);

CREATE INDEX IF NOT EXISTS influencer_payout_requests_influencer_created_idx
ON public.influencer_payout_requests (influencer_id, created_at DESC);

ALTER TABLE public.influencer_payout_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "influencer_payout_requests_select_own" ON public.influencer_payout_requests;
CREATE POLICY "influencer_payout_requests_select_own"
ON public.influencer_payout_requests
FOR SELECT
TO authenticated
USING (auth.uid () = influencer_id OR public.is_admin_user (auth.uid ()));

-- ---------------------------------------------------------------------------
-- Komisyon kaydı
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_influencer_approved (p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.influencer_profiles AS ip
    WHERE ip.user_id = p_user_id
      AND ip.status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_influencer_wallet_entry_withdrawable (
  p_entry_type text,
  p_package_order_id uuid,
  p_created_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_entry_type IN ('referral_commission', 'referral_commission_refund') THEN
      p_package_order_id IS NOT NULL
      AND public.mentor_wallet_sale_withdrawable_at(p_package_order_id, p_created_at) <= now()
    WHEN p_entry_type = 'adjustment' THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_influencer_wallet_available_balance (p_influencer_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT sum(iwl.net_amount)
      FROM public.influencer_wallet_ledger AS iwl
      WHERE iwl.influencer_id = p_influencer_id
        AND (
          iwl.entry_type IN ('payout', 'adjustment')
          OR public.is_influencer_wallet_entry_withdrawable(
            iwl.entry_type,
            iwl.package_order_id,
            iwl.created_at
          )
        )
    ),
    0
  ) - coalesce(
    (
      SELECT sum(ipr.amount_requested)
      FROM public.influencer_payout_requests AS ipr
      WHERE ipr.influencer_id = p_influencer_id
        AND ipr.status IN ('pending', 'processing')
    ),
    0
  );
$$;

REVOKE ALL ON FUNCTION public.get_influencer_wallet_available_balance (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_influencer_wallet_available_balance (uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_influencer_referral_commission (p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.package_orders%ROWTYPE;
  v_attribution public.user_referral_attribution%ROWTYPE;
  v_commission numeric;
  v_buyer_name text;
  v_ledger_id uuid;
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
  FROM public.influencer_wallet_ledger AS iwl
  WHERE iwl.package_order_id = p_order_id
    AND iwl.entry_type = 'referral_commission'
  LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    RETURN v_ledger_id;
  END IF;

  SELECT ura.*
  INTO v_attribution
  FROM public.user_referral_attribution AS ura
  WHERE ura.user_id = v_order.user_id
    AND ura.referrer_type = 'influencer'
    AND ura.commission_until > coalesce(v_order.paid_at, now());

  IF NOT FOUND OR NOT public.is_influencer_approved(v_attribution.referrer_user_id) THEN
    RETURN NULL;
  END IF;

  v_commission := round(
    coalesce(v_order.amount_paid, v_order.list_price) * public.referral_commission_rate(),
    2
  );

  IF v_commission <= 0 THEN
    RETURN NULL;
  END IF;

  v_buyer_name := coalesce(public.notification_actor_label(v_order.user_id), 'Kullanıcı');

  INSERT INTO public.influencer_wallet_ledger (
    influencer_id,
    package_order_id,
    entry_type,
    gross_amount,
    net_amount,
    currency,
    package_title,
    buyer_display_name
  )
  VALUES (
    v_attribution.referrer_user_id,
    v_order.id,
    'referral_commission',
    coalesce(v_order.amount_paid, v_order.list_price),
    v_commission,
    lower(trim(v_order.currency)),
    v_order.package_title,
    v_buyer_name
  )
  RETURNING id INTO v_ledger_id;

  UPDATE public.package_orders
  SET referral_payout_influencer_id = v_attribution.referrer_user_id,
      referral_influencer_commission_amount = v_commission,
      referral_commission_type = coalesce(referral_commission_type, 'influencer_sale'),
      updated_at = now()
  WHERE id = v_order.id;

  RETURN v_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_influencer_referral_commission (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_influencer_referral_commission (uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_influencer_referral_commission_refund (p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bonus public.influencer_wallet_ledger%ROWTYPE;
  v_ledger_id uuid;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_bonus
  FROM public.influencer_wallet_ledger AS iwl
  WHERE iwl.package_order_id = p_order_id
    AND iwl.entry_type = 'referral_commission'
  LIMIT 1;

  IF NOT FOUND OR v_bonus.net_amount <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT id
  INTO v_ledger_id
  FROM public.influencer_wallet_ledger AS iwl
  WHERE iwl.package_order_id = p_order_id
    AND iwl.entry_type = 'referral_commission_refund'
  LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    RETURN v_ledger_id;
  END IF;

  INSERT INTO public.influencer_wallet_ledger (
    influencer_id,
    package_order_id,
    entry_type,
    gross_amount,
    net_amount,
    currency,
    package_title,
    buyer_display_name
  )
  VALUES (
    v_bonus.influencer_id,
    p_order_id,
    'referral_commission_refund',
    v_bonus.gross_amount,
    round(v_bonus.net_amount * -1, 2),
    v_bonus.currency,
    v_bonus.package_title,
    v_bonus.buyer_display_name
  )
  RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_influencer_referral_commission_refund (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_influencer_referral_commission_refund (uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_package_order_influencer_commission ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    PERFORM public.record_influencer_referral_commission(NEW.id);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'refunded' AND OLD.status = 'paid' THEN
    PERFORM public.record_influencer_referral_commission_refund(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS package_order_influencer_commission ON public.package_orders;

CREATE TRIGGER package_order_influencer_commission
AFTER UPDATE OF status ON public.package_orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_package_order_influencer_commission();

-- ---------------------------------------------------------------------------
-- Başvuru RPC'leri
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_influencer_application ()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_row public.influencer_profiles%ROWTYPE;
  v_display_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT p.display_name
  INTO v_display_name
  FROM public.profiles AS p
  WHERE p.id = v_user_id;

  SELECT *
  INTO v_row
  FROM public.influencer_profiles AS ip
  WHERE ip.user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'none',
      'display_name', coalesce(v_display_name, '')
    );
  END IF;

  RETURN jsonb_build_object(
    'status', v_row.status,
    'display_label', v_row.display_label,
    'social_platform', v_row.social_platform,
    'social_handle', v_row.social_handle,
    'follower_range', v_row.follower_range,
    'application_note', v_row.application_note,
    'contact_email', v_row.contact_email,
    'website_url', v_row.website_url,
    'approved_at', v_row.approved_at,
    'created_at', v_row.created_at,
    'display_name', coalesce(v_display_name, '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_influencer_application () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_influencer_application () TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_influencer_application (
  p_display_label text DEFAULT '',
  p_social_platform text DEFAULT '',
  p_social_handle text DEFAULT '',
  p_follower_range text DEFAULT '',
  p_application_note text DEFAULT '',
  p_contact_email text DEFAULT '',
  p_website_url text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing public.influencer_profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.influencer_profiles AS ip
  WHERE ip.user_id = v_user_id;

  IF FOUND AND v_existing.status = 'approved' THEN
    RAISE EXCEPTION 'influencer_already_approved';
  END IF;

  IF FOUND AND v_existing.status = 'rejected' THEN
    RAISE EXCEPTION 'influencer_application_rejected';
  END IF;

  INSERT INTO public.influencer_profiles (
    user_id,
    status,
    display_label,
    social_platform,
    social_handle,
    follower_range,
    application_note,
    contact_email,
    website_url
  )
  VALUES (
    v_user_id,
    'pending',
    left(btrim(coalesce(p_display_label, '')), 120),
    left(btrim(coalesce(p_social_platform, '')), 80),
    left(btrim(coalesce(p_social_handle, '')), 120),
    left(btrim(coalesce(p_follower_range, '')), 80),
    left(btrim(coalesce(p_application_note, '')), 2000),
    left(btrim(coalesce(p_contact_email, '')), 200),
    left(btrim(coalesce(p_website_url, '')), 300)
  )
  ON CONFLICT (user_id) DO UPDATE
  SET status = 'pending',
      display_label = EXCLUDED.display_label,
      social_platform = EXCLUDED.social_platform,
      social_handle = EXCLUDED.social_handle,
      follower_range = EXCLUDED.follower_range,
      application_note = EXCLUDED.application_note,
      contact_email = EXCLUDED.contact_email,
      website_url = EXCLUDED.website_url,
      updated_at = now()
  WHERE public.influencer_profiles.status = 'pending';

  RETURN public.get_my_influencer_application();
END;
$$;

REVOKE ALL ON FUNCTION public.submit_influencer_application (text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_influencer_application (text, text, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Influencer panel + cüzdan özeti
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_influencer_referral_program ()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_campaign public.referral_campaigns%ROWTYPE;
  v_signup_count integer := 0;
  v_click_count integer := 0;
  v_order_count integer := 0;
  v_commission_total numeric := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT public.is_influencer_approved(v_user_id) THEN
    RAISE EXCEPTION 'influencer_not_approved';
  END IF;

  v_campaign := public.ensure_referral_campaign(v_user_id, 'influencer');

  SELECT count(*)::integer
  INTO v_signup_count
  FROM public.user_referral_attribution AS ura
  WHERE ura.campaign_id = v_campaign.id;

  SELECT count(*)::integer
  INTO v_click_count
  FROM public.referral_clicks AS rc
  WHERE rc.campaign_id = v_campaign.id;

  SELECT
    count(*)::integer,
    coalesce(sum(iwl.net_amount), 0)
  INTO v_order_count, v_commission_total
  FROM public.influencer_wallet_ledger AS iwl
  WHERE iwl.influencer_id = v_user_id
    AND iwl.entry_type = 'referral_commission';

  RETURN jsonb_build_object(
    'campaign_type', 'influencer',
    'code', v_campaign.code,
    'link_path', '/r/' || v_campaign.code,
    'signup_count', v_signup_count,
    'click_count', v_click_count,
    'order_count', v_order_count,
    'commission_total', v_commission_total,
    'commission_rate', public.referral_commission_rate(),
    'commission_years', public.referral_commission_years(),
    'click_window_days', public.referral_click_window_days()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_influencer_wallet_summary ()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_available numeric;
  v_held numeric;
  v_total_commission numeric;
  v_order_count integer;
  v_pending_payout numeric;
  v_transactions jsonb;
  v_payout_requests jsonb;
  v_payout_ready boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF NOT public.is_influencer_approved(v_user_id) THEN
    RAISE EXCEPTION 'influencer_not_approved';
  END IF;

  v_available := public.get_influencer_wallet_available_balance(v_user_id);

  SELECT
    coalesce(sum(iwl.net_amount), 0),
    count(*) FILTER (WHERE iwl.entry_type = 'referral_commission')::integer
  INTO v_total_commission, v_order_count
  FROM public.influencer_wallet_ledger AS iwl
  WHERE iwl.influencer_id = v_user_id
    AND iwl.entry_type IN ('referral_commission', 'referral_commission_refund');

  SELECT coalesce(sum(iwl.net_amount), 0)
  INTO v_held
  FROM public.influencer_wallet_ledger AS iwl
  WHERE iwl.influencer_id = v_user_id
    AND iwl.entry_type = 'referral_commission'
    AND NOT public.is_influencer_wallet_entry_withdrawable(
      iwl.entry_type,
      iwl.package_order_id,
      iwl.created_at
    );

  SELECT coalesce(sum(ipr.amount_requested), 0)
  INTO v_pending_payout
  FROM public.influencer_payout_requests AS ipr
  WHERE ipr.influencer_id = v_user_id
    AND ipr.status IN ('pending', 'processing');

  SELECT EXISTS (
    SELECT 1
    FROM public.influencer_payout_accounts AS ipa
    WHERE ipa.user_id = v_user_id
  )
  INTO v_payout_ready;

  SELECT coalesce(jsonb_agg(row_to_json(tx)::jsonb ORDER BY tx.created_at DESC), '[]'::jsonb)
  INTO v_transactions
  FROM (
    SELECT
      iwl.id,
      iwl.entry_type,
      iwl.package_title,
      iwl.buyer_display_name,
      iwl.gross_amount,
      iwl.net_amount,
      iwl.currency,
      iwl.created_at,
      public.is_influencer_wallet_entry_withdrawable(
        iwl.entry_type,
        iwl.package_order_id,
        iwl.created_at
      ) AS is_withdrawable
    FROM public.influencer_wallet_ledger AS iwl
    WHERE iwl.influencer_id = v_user_id
    ORDER BY iwl.created_at DESC
    LIMIT 50
  ) AS tx;

  SELECT coalesce(jsonb_agg(row_to_json(pr)::jsonb ORDER BY pr.created_at DESC), '[]'::jsonb)
  INTO v_payout_requests
  FROM (
    SELECT
      ipr.id,
      ipr.amount_requested,
      ipr.transfer_fee,
      ipr.amount_net,
      ipr.status,
      ipr.created_at,
      ipr.processed_at
    FROM public.influencer_payout_requests AS ipr
    WHERE ipr.influencer_id = v_user_id
    ORDER BY ipr.created_at DESC
    LIMIT 20
  ) AS pr;

  RETURN jsonb_build_object(
    'available_balance', v_available,
    'held_balance', v_held,
    'total_commission', v_total_commission,
    'order_count', v_order_count,
    'pending_payout', v_pending_payout,
    'payout_ready', v_payout_ready,
    'payout_min_amount', 500,
    'payout_transfer_fee', 35,
    'payout_hold_days', 14,
    'commission_rate_pct', round(public.referral_commission_rate() * 100, 2),
    'transactions', v_transactions,
    'payout_requests', v_payout_requests
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_influencer_wallet_summary () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_influencer_wallet_summary () TO authenticated;

CREATE OR REPLACE FUNCTION public.request_influencer_payout (
  p_amount numeric DEFAULT NULL,
  p_transfer_fee numeric DEFAULT 35,
  p_wise_quote_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_available numeric;
  v_amount numeric;
  v_transfer_fee numeric := round(greatest(coalesce(p_transfer_fee, 35), 0), 2);
  v_amount_net numeric;
  v_request_id uuid;
  v_min_amount numeric := 500;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
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

REVOKE ALL ON FUNCTION public.request_influencer_payout (numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_influencer_payout (numeric, numeric, text) TO authenticated;

-- Wise ödeme işleme (mentör akışının influencer sürümü)
CREATE OR REPLACE FUNCTION public.begin_influencer_payout_processing (p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.influencer_payout_requests
  SET status = 'processing'
  WHERE id = p_request_id
    AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_influencer_payout (
  p_request_id uuid,
  p_wise_transfer_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.influencer_payout_requests%ROWTYPE;
  v_ledger_id uuid;
BEGIN
  SELECT *
  INTO v_row
  FROM public.influencer_payout_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_request_not_found';
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN jsonb_build_object('request_id', v_row.id, 'status', 'completed', 'already_completed', true);
  END IF;

  IF v_row.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'payout_request_not_processable';
  END IF;

  SELECT id
  INTO v_ledger_id
  FROM public.influencer_wallet_ledger AS iwl
  WHERE iwl.influencer_id = v_row.influencer_id
    AND iwl.entry_type = 'payout'
    AND iwl.package_order_id IS NULL
    AND iwl.net_amount = -v_row.amount_requested
    AND iwl.created_at >= v_row.created_at - interval '1 minute'
  LIMIT 1;

  IF v_ledger_id IS NULL THEN
    INSERT INTO public.influencer_wallet_ledger (
      influencer_id,
      entry_type,
      net_amount,
      currency,
      package_title
    )
    VALUES (
      v_row.influencer_id,
      'payout',
      -v_row.amount_requested,
      'try',
      'Ödeme talebi'
    )
    RETURNING id INTO v_ledger_id;
  END IF;

  UPDATE public.influencer_payout_requests
  SET status = 'completed',
      wise_transfer_id = p_wise_transfer_id,
      processed_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'request_id', v_row.id,
    'status', v_row.status,
    'ledger_id', v_ledger_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_influencer_payout (
  p_request_id uuid,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.influencer_payout_requests%ROWTYPE;
BEGIN
  SELECT *
  INTO v_row
  FROM public.influencer_payout_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_request_not_found';
  END IF;

  IF v_row.status IN ('completed', 'canceled') THEN
    RETURN jsonb_build_object('request_id', v_row.id, 'status', v_row.status, 'skipped', true);
  END IF;

  UPDATE public.influencer_payout_requests
  SET status = 'rejected',
      failure_reason = left(btrim(coalesce(p_reason, '')), 500),
      processed_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.influencer_wallet_ledger (
    influencer_id,
    entry_type,
    net_amount,
    currency
  )
  VALUES (
    v_row.influencer_id,
    'adjustment',
    v_row.amount_requested,
    'try'
  );

  RETURN jsonb_build_object('request_id', v_row.id, 'status', 'rejected');
END;
$$;

CREATE OR REPLACE FUNCTION public.save_influencer_wise_recipient (
  p_influencer_id uuid,
  p_wise_recipient_id bigint,
  p_iban text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.influencer_payout_accounts
  SET wise_recipient_id = p_wise_recipient_id,
      wise_recipient_iban = upper(btrim(coalesce(p_iban, ''))),
      updated_at = now()
  WHERE user_id = p_influencer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_influencer_payout_transfer_details (p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.influencer_payout_requests%ROWTYPE;
  v_account public.influencer_payout_accounts%ROWTYPE;
BEGIN
  SELECT *
  INTO v_row
  FROM public.influencer_payout_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_request_not_found';
  END IF;

  SELECT *
  INTO v_account
  FROM public.influencer_payout_accounts
  WHERE user_id = v_row.influencer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_account_required';
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_row.id,
    'influencer_id', v_row.influencer_id,
    'amount_net', v_row.amount_net,
    'transfer_fee', v_row.transfer_fee,
    'amount_requested', v_row.amount_requested,
    'status', v_row.status,
    'account_holder', v_account.account_holder,
    'bank_name', v_account.bank_name,
    'iban', v_account.iban,
    'wise_recipient_id', v_account.wise_recipient_id,
    'wise_recipient_iban', v_account.wise_recipient_iban
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_influencer_payout_processing (uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_influencer_payout (uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_influencer_payout (uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_influencer_wise_recipient (uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_influencer_payout_transfer_details (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_influencer_payout_processing (uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_influencer_payout (uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_influencer_payout (uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_influencer_wise_recipient (uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_influencer_payout_transfer_details (uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Admin listesi (başvuru detayları)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_influencer_applications ()
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
          ip.user_id,
          ip.status,
          ip.display_label,
          ip.social_platform,
          ip.social_handle,
          ip.follower_range,
          ip.application_note,
          ip.contact_email,
          ip.website_url,
          ip.approved_at,
          ip.created_at,
          coalesce(p.display_name, ip.display_label, 'Kullanıcı') AS display_name,
          p.email,
          rc.code AS referral_code,
          (
            SELECT count(*)::integer
            FROM public.user_referral_attribution AS ura
            WHERE ura.referrer_user_id = ip.user_id
          ) AS signup_count
        FROM public.influencer_profiles AS ip
        JOIN public.profiles AS p ON p.id = ip.user_id
        LEFT JOIN public.referral_campaigns AS rc
          ON rc.owner_user_id = ip.user_id
          AND rc.campaign_type = 'influencer'
        ORDER BY ip.created_at DESC
      ) AS q
    ),
    '[]'::jsonb
  );
END;
$$;
