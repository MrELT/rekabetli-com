-- Wise otomatik ödeme + cüzdan payout kaydı düzeltmesi
-- supabase-mentor-payout-account.sql ve supabase-mentor-wallet.sql sonrasında çalıştırın.

ALTER TABLE public.mentor_payout_accounts
ADD COLUMN IF NOT EXISTS wise_recipient_id bigint;

COMMENT ON COLUMN public.mentor_payout_accounts.wise_recipient_id IS
  'Wise recipient account id; IBAN değişince sıfırlanmalı.';

ALTER TABLE public.mentor_payout_accounts
ADD COLUMN IF NOT EXISTS wise_recipient_iban text NOT NULL DEFAULT '';

ALTER TABLE public.mentor_payout_requests
ADD COLUMN IF NOT EXISTS wise_quote_id text,
ADD COLUMN IF NOT EXISTS wise_transfer_id text,
ADD COLUMN IF NOT EXISTS failure_reason text NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS admin_note text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.sync_mentor_payout_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.mentor_pages
    SET payout_ready = false,
        updated_at = now()
    WHERE user_id = OLD.user_id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.iban IS DISTINCT FROM OLD.iban THEN
    NEW.wise_recipient_id := NULL;
    NEW.wise_recipient_iban := '';
  END IF;

  UPDATE public.mentor_pages
  SET payout_ready = true,
      updated_at = now()
  WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_mentor_payout_processing (p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mentor_payout_requests%ROWTYPE;
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

  IF v_row.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'payout_request_not_processable';
  END IF;

  IF v_row.status = 'pending' THEN
    UPDATE public.mentor_payout_requests
    SET status = 'processing',
        updated_at = now()
    WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_row.id,
    'mentor_id', v_row.mentor_id,
    'amount_requested', v_row.amount_requested,
    'transfer_fee', v_row.transfer_fee,
    'amount_net', v_row.amount_net,
    'status', 'processing'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_mentor_payout_processing (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_mentor_payout_processing (uuid) TO service_role;

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
    RETURN jsonb_build_object('request_id', v_row.id, 'status', 'completed', 'already_completed', true);
  END IF;

  IF v_row.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'payout_request_not_processable';
  END IF;

  SELECT id
  INTO v_ledger_id
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.mentor_id = v_row.mentor_id
    AND mwl.entry_type = 'payout'
    AND mwl.package_order_id IS NULL
    AND mwl.net_amount = -v_row.amount_requested
    AND mwl.created_at >= v_row.created_at - interval '1 minute'
  LIMIT 1;

  IF v_ledger_id IS NULL THEN
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
      v_row.mentor_id,
      NULL,
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

CREATE OR REPLACE FUNCTION public.fail_mentor_payout (
  p_request_id uuid,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mentor_payout_requests%ROWTYPE;
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
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

  IF v_row.status IN ('completed', 'canceled') THEN
    RAISE EXCEPTION 'payout_request_not_processable';
  END IF;

  UPDATE public.mentor_payout_requests
  SET status = 'pending',
      failure_reason = v_reason,
      updated_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'request_id', v_row.id,
    'status', 'pending',
    'failure_reason', v_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fail_mentor_payout (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fail_mentor_payout (uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.save_mentor_wise_recipient (
  p_mentor_id uuid,
  p_wise_recipient_id bigint,
  p_iban text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.mentor_payout_accounts
  SET wise_recipient_id = p_wise_recipient_id,
      wise_recipient_iban = p_iban,
      updated_at = now()
  WHERE user_id = p_mentor_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_mentor_wise_recipient (uuid, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_mentor_wise_recipient (uuid, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_mentor_payout_transfer_details (p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mentor_payout_requests%ROWTYPE;
  v_account public.mentor_payout_accounts%ROWTYPE;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'payout_request_invalid';
  END IF;

  SELECT *
  INTO v_row
  FROM public.mentor_payout_requests AS mpr
  WHERE mpr.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_request_not_found';
  END IF;

  SELECT *
  INTO v_account
  FROM public.mentor_payout_accounts AS mpa
  WHERE mpa.user_id = v_row.mentor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_account_required';
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_row.id,
    'mentor_id', v_row.mentor_id,
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

REVOKE ALL ON FUNCTION public.get_mentor_payout_transfer_details (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_payout_transfer_details (uuid) TO service_role;
