-- Admin ödeme kuyruğuna gider pusulası bilgisi
-- supabase-mentor-self-billing-invoice.sql sonrasında çalıştırın.

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
          mpr.invoice_number,
          (mpr.self_billed_invoice_path IS NOT NULL) AS has_self_billed_invoice,
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
