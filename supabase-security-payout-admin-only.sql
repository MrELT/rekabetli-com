-- H2: Ödeme işleme yalnızca admin panelinden — influencer kuyruğu admin RPC'ye eklendi.

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
          'mentor'::text AS payout_type,
          mpr.mentor_id AS recipient_id,
          mpr.amount_requested,
          mpr.transfer_fee,
          mpr.amount_net,
          mpr.status,
          mpr.failure_reason,
          mpr.wise_transfer_id,
          mpr.created_at,
          mpr.processed_at,
          mpr.invoice_number,
          (mpr.self_billed_invoice_path IS NOT NULL) AS has_self_billed_invoice,
          coalesce(public.notification_actor_label(mpr.mentor_id), 'Mentör') AS recipient_name,
          coalesce(public.notification_actor_label(mpr.mentor_id), 'Mentör') AS mentor_name,
          mpa.account_holder,
          mpa.bank_name,
          mpa.iban
        FROM public.mentor_payout_requests AS mpr
        LEFT JOIN public.mentor_payout_accounts AS mpa ON mpa.user_id = mpr.mentor_id
        WHERE mpr.status IN ('pending', 'processing', 'completed', 'rejected')

        UNION ALL

        SELECT
          ipr.id,
          'influencer'::text AS payout_type,
          ipr.influencer_id AS recipient_id,
          ipr.amount_requested,
          ipr.transfer_fee,
          ipr.amount_net,
          ipr.status,
          ipr.failure_reason,
          ipr.wise_transfer_id,
          ipr.created_at,
          ipr.processed_at,
          NULL::text AS invoice_number,
          false AS has_self_billed_invoice,
          coalesce(public.notification_actor_label(ipr.influencer_id), 'Influencer') AS recipient_name,
          coalesce(public.notification_actor_label(ipr.influencer_id), 'Influencer') AS mentor_name,
          ipa.account_holder,
          ipa.bank_name,
          ipa.iban
        FROM public.influencer_payout_requests AS ipr
        LEFT JOIN public.influencer_payout_accounts AS ipa ON ipa.user_id = ipr.influencer_id
        WHERE ipr.status IN ('pending', 'processing', 'completed', 'rejected')

        ORDER BY created_at DESC
        LIMIT 100
      ) AS q
    ),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_payout_queue () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_payout_queue () TO authenticated;
