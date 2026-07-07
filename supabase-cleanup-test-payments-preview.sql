-- Test ödeme verisi önizleme (silmez)
-- Stripe test: cs_test_ / pi_test_

SELECT 'package_orders' AS tbl, status, COUNT(*) AS cnt
FROM public.package_orders
WHERE stripe_checkout_session_id LIKE 'cs_test_%'
   OR stripe_payment_intent_id LIKE 'pi_test_%'
   OR (
     status IN ('paid', 'refunded')
     AND coalesce(stripe_checkout_session_id, '') NOT LIKE 'cs_live_%'
     AND coalesce(stripe_payment_intent_id, '') NOT LIKE 'pi_live_%'
   )
GROUP BY status
ORDER BY status;

SELECT 'mentor_wallet_ledger' AS tbl, entry_type, COUNT(*) AS cnt, round(sum(net_amount), 2) AS net_sum
FROM public.mentor_wallet_ledger AS mwl
WHERE mwl.package_order_id IN (
  SELECT po.id
  FROM public.package_orders AS po
  WHERE po.stripe_checkout_session_id LIKE 'cs_test_%'
     OR po.stripe_payment_intent_id LIKE 'pi_test_%'
     OR (
       po.status IN ('paid', 'refunded')
       AND coalesce(po.stripe_checkout_session_id, '') NOT LIKE 'cs_live_%'
       AND coalesce(po.stripe_payment_intent_id, '') NOT LIKE 'pi_live_%'
     )
)
   OR (
     mwl.entry_type = 'payout'
     AND mwl.mentor_id IN (
       SELECT DISTINCT po.mentor_id
       FROM public.package_orders AS po
       WHERE po.stripe_checkout_session_id LIKE 'cs_test_%'
          OR po.stripe_payment_intent_id LIKE 'pi_test_%'
     )
   )
GROUP BY entry_type;

SELECT 'mentor_payout_requests' AS tbl, status, COUNT(*) AS cnt, round(sum(amount_requested), 2) AS total
FROM public.mentor_payout_requests
GROUP BY status;

SELECT mentor_id, round(sum(net_amount), 2) AS wallet_net
FROM public.mentor_wallet_ledger
GROUP BY mentor_id
ORDER BY wallet_net DESC
LIMIT 10;
