-- Self-billed invoice (gider pusulası): PDF yolu, fatura no, storage bucket
-- supabase-mentor-payout-self-billing.sql ve supabase-mentor-wallet-refund-held-balance.sql sonrasında çalıştırın.

ALTER TABLE public.mentor_payout_requests
ADD COLUMN IF NOT EXISTS invoice_number text,
ADD COLUMN IF NOT EXISTS self_billed_invoice_path text;

COMMENT ON COLUMN public.mentor_payout_requests.invoice_number IS
  'Self-billed invoice numarası (ör. INV-2026-000042).';

COMMENT ON COLUMN public.mentor_payout_requests.self_billed_invoice_path IS
  'Storage yolu: self_billing_invoices/{mentor_id}/{request_id}.pdf';

CREATE UNIQUE INDEX IF NOT EXISTS mentor_payout_requests_invoice_number_uidx
ON public.mentor_payout_requests (invoice_number)
WHERE invoice_number IS NOT NULL;

ALTER TABLE public.mentor_wallet_ledger
ADD COLUMN IF NOT EXISTS payout_request_id uuid REFERENCES public.mentor_payout_requests (id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS receipt_url text;

COMMENT ON COLUMN public.mentor_wallet_ledger.payout_request_id IS
  'Ödeme talebi ile ilişkili cüzdan satırı.';

COMMENT ON COLUMN public.mentor_wallet_ledger.receipt_url IS
  'Self-billed invoice storage yolu (self_billed_invoice_path ile aynı).';

CREATE INDEX IF NOT EXISTS mentor_wallet_ledger_payout_request_idx
ON public.mentor_wallet_ledger (payout_request_id)
WHERE payout_request_id IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS public.self_billed_invoice_number_seq;

CREATE OR REPLACE FUNCTION public.allocate_self_billed_invoice_number ()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT format(
    'INV-%s-%s',
    to_char(now() AT TIME ZONE 'UTC', 'YYYY'),
    lpad(nextval('public.self_billed_invoice_number_seq')::text, 6, '0')
  );
$$;

REVOKE ALL ON FUNCTION public.allocate_self_billed_invoice_number () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_self_billed_invoice_number () TO service_role;

CREATE OR REPLACE FUNCTION public.attach_self_billed_invoice (
  p_request_id uuid,
  p_storage_path text,
  p_invoice_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mentor_payout_requests%ROWTYPE;
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_invoice text := nullif(btrim(coalesce(p_invoice_number, '')), '');
BEGIN
  IF p_request_id IS NULL OR v_path IS NULL OR v_invoice IS NULL THEN
    RAISE EXCEPTION 'self_billed_invoice_invalid';
  END IF;

  SELECT *
  INTO v_row
  FROM public.mentor_payout_requests AS mpr
  WHERE mpr.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_request_not_found';
  END IF;

  IF v_row.status <> 'completed' THEN
    RAISE EXCEPTION 'payout_request_not_completed';
  END IF;

  UPDATE public.mentor_payout_requests
  SET invoice_number = coalesce(v_row.invoice_number, v_invoice),
      self_billed_invoice_path = coalesce(v_row.self_billed_invoice_path, v_path),
      updated_at = now()
  WHERE id = v_row.id;

  UPDATE public.mentor_wallet_ledger AS mwl
  SET payout_request_id = coalesce(mwl.payout_request_id, v_row.id),
      receipt_url = coalesce(mwl.receipt_url, v_path)
  WHERE mwl.mentor_id = v_row.mentor_id
    AND mwl.entry_type = 'payout'
    AND (
      mwl.payout_request_id = v_row.id
      OR (
        mwl.payout_request_id IS NULL
        AND mwl.net_amount = -v_row.amount_requested
        AND mwl.created_at >= v_row.created_at - interval '5 minutes'
      )
    );

  RETURN jsonb_build_object(
    'request_id', v_row.id,
    'invoice_number', coalesce(v_row.invoice_number, v_invoice),
    'self_billed_invoice_path', coalesce(v_row.self_billed_invoice_path, v_path)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attach_self_billed_invoice (uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_self_billed_invoice (uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_mentor_payout (
  p_request_id uuid,
  p_wise_transfer_id text DEFAULT NULL,
  p_wise_quote_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mentor_payout_requests%ROWTYPE;
  v_ledger_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'payout_request_invalid';
  END IF;

  SELECT *
  INTO v_row
  FROM public.mentor_payout_requests AS mpr
  WHERE mpr.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_request_not_found';
  END IF;

  IF v_row.status = 'completed' THEN
  SELECT id
  INTO v_ledger_id
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.payout_request_id = v_row.id
  LIMIT 1;

  IF v_ledger_id IS NULL THEN
    SELECT id
    INTO v_ledger_id
    FROM public.mentor_wallet_ledger AS mwl
    WHERE mwl.mentor_id = v_row.mentor_id
      AND mwl.entry_type = 'payout'
      AND mwl.net_amount = -v_row.amount_requested
      AND mwl.created_at >= v_row.created_at - interval '5 minutes'
    LIMIT 1;
  END IF;

    RETURN jsonb_build_object(
      'request_id', v_row.id,
      'status', 'completed',
      'already_completed', true,
      'ledger_id', v_ledger_id,
      'invoice_number', v_row.invoice_number,
      'self_billed_invoice_path', v_row.self_billed_invoice_path
    );
  END IF;

  IF v_row.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'payout_request_not_processable';
  END IF;

  SELECT id
  INTO v_ledger_id
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.payout_request_id = v_row.id
  LIMIT 1;

  IF v_ledger_id IS NULL THEN
    SELECT id
    INTO v_ledger_id
    FROM public.mentor_wallet_ledger AS mwl
    WHERE mwl.mentor_id = v_row.mentor_id
      AND mwl.entry_type = 'payout'
      AND mwl.package_order_id IS NULL
      AND mwl.net_amount = -v_row.amount_requested
      AND mwl.created_at >= v_row.created_at - interval '5 minutes'
    LIMIT 1;
  END IF;

  IF v_ledger_id IS NULL THEN
    INSERT INTO public.mentor_wallet_ledger (
      mentor_id,
      package_order_id,
      payout_request_id,
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
      v_row.mentor_id,
      NULL,
      v_row.id,
      'payout',
      0,
      0,
      v_row.transfer_fee,
      -v_row.amount_requested,
      lower(trim(v_row.currency)),
      'Ödeme talebi',
      ''
    )
    RETURNING id INTO v_ledger_id;
  ELSE
    UPDATE public.mentor_wallet_ledger AS mwl
    SET payout_request_id = coalesce(mwl.payout_request_id, v_row.id)
    WHERE mwl.id = v_ledger_id;
  END IF;

  UPDATE public.mentor_payout_requests
  SET status = 'completed',
      wise_transfer_id = nullif(btrim(coalesce(p_wise_transfer_id, '')), ''),
      wise_quote_id = nullif(btrim(coalesce(p_wise_quote_id, '')), ''),
      failure_reason = '',
      processed_at = now(),
      updated_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'request_id', v_row.id,
    'status', 'completed',
    'ledger_id', v_ledger_id,
    'wise_transfer_id', p_wise_transfer_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_mentor_payout (uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_mentor_payout (uuid, text, text) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'self_billing_invoices',
  'self_billing_invoices',
  false,
  5242880,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "self_billing_invoices_select_own" ON storage.objects;
DROP POLICY IF EXISTS "self_billing_invoices_select_admin" ON storage.objects;

CREATE POLICY "self_billing_invoices_select_own"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'self_billing_invoices'
  AND (storage.foldername (name))[1] = auth.uid ()::text
);

CREATE POLICY "self_billing_invoices_select_admin"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'self_billing_invoices'
  AND public.is_admin_user (auth.uid ())
);

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
  v_held_balance_items jsonb;
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
    AND mwl.entry_type IN ('package_sale', 'referral_bonus', 'refund', 'referral_bonus_refund')
    AND NOT public.is_mentor_wallet_entry_withdrawable(
      mwl.entry_type,
      mwl.package_order_id,
      mwl.created_at
    );

  SELECT coalesce(jsonb_agg(row_to_json(hi)::jsonb ORDER BY hi.sort_key ASC, hi.withdrawable_at ASC NULLS LAST), '[]'::jsonb)
  INTO v_held_balance_items
  FROM (
    SELECT
      mwl.id,
      mwl.entry_type,
      mwl.package_title,
      mwl.student_display_name,
      mwl.net_amount,
      mwl.created_at,
      public.get_package_order_first_meeting_at(mwl.package_order_id) AS first_meeting_at,
      public.package_order_payout_hold_reason(mwl.package_order_id, mwl.created_at) AS payout_hold_reason,
      public.mentor_wallet_sale_withdrawable_at(mwl.package_order_id, mwl.created_at) AS withdrawable_at,
      CASE
        WHEN mwl.entry_type IN ('refund', 'referral_bonus_refund') THEN 2
        WHEN public.get_package_order_first_meeting_at(mwl.package_order_id) IS NULL THEN 0
        ELSE 1
      END AS sort_key
    FROM public.mentor_wallet_ledger AS mwl
    WHERE mwl.mentor_id = v_mentor_id
      AND mwl.entry_type IN ('package_sale', 'referral_bonus', 'refund', 'referral_bonus_refund')
      AND NOT public.is_mentor_wallet_entry_withdrawable(
        mwl.entry_type,
        mwl.package_order_id,
        mwl.created_at
      )
  ) AS hi;

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
      public.get_package_order_first_meeting_at(mwl.package_order_id) AS first_meeting_at,
      public.package_order_payout_hold_reason(mwl.package_order_id, mwl.created_at) AS payout_hold_reason,
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
      mpr.processed_at,
      mpr.invoice_number,
      (mpr.self_billed_invoice_path IS NOT NULL) AS has_self_billed_invoice
    FROM public.mentor_payout_requests AS mpr
    WHERE mpr.mentor_id = v_mentor_id
    ORDER BY mpr.created_at DESC
    LIMIT 20
  ) AS pr;

  RETURN jsonb_build_object(
    'available_balance', v_available,
    'held_balance', v_held_balance,
    'held_balance_items', v_held_balance_items,
    'payout_hold_days', v_hold_days,
    'payout_hold_anchor', 'first_meeting',
    'total_gross', v_total_gross,
    'total_platform_fee', v_total_platform_fee,
    'total_net', v_total_net,
    'referral_bonus_total', v_referral_bonus_total,
    'sale_count', v_sale_count,
    'pending_payout', v_pending_payout,
    'commission_rate_pct', v_commission_pct,
    'payment_fees_covered_by_platform', true,
    'payout_fee_source', 'wise',
    'payout_min_amount', public.get_mentor_payout_min_amount(),
    'transactions', v_transactions,
    'payout_requests', v_payout_requests
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mentor_wallet_summary () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_wallet_summary () TO authenticated;
