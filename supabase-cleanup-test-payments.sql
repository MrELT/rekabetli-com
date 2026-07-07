-- Test Stripe ödeme verilerini temizle (cs_test_ / canlı olmayan siparişler)
-- Canlı siparişler korunur: stripe_checkout_session_id LIKE 'cs_live_%'
-- Bir kez çalıştırın. Önizleme: supabase-cleanup-test-payments-preview.sql

BEGIN;

CREATE TEMP TABLE _test_orders ON COMMIT DROP AS
SELECT
  po.id,
  po.user_id,
  po.mentor_id,
  po.package_id,
  po.enrollment_id,
  po.status
FROM public.package_orders AS po
WHERE coalesce(po.stripe_checkout_session_id, '') NOT LIKE 'cs_live_%';

CREATE TEMP TABLE _test_enrollments ON COMMIT DROP AS
SELECT DISTINCT eid AS enrollment_id
FROM (
  SELECT t.enrollment_id AS eid
  FROM _test_orders AS t
  WHERE t.enrollment_id IS NOT NULL

  UNION

  SELECT mps.id AS eid
  FROM public.mentor_package_students AS mps
  INNER JOIN _test_orders AS t
    ON t.mentor_id = mps.mentor_id
   AND t.user_id = mps.student_id
   AND t.package_id = mps.package_id
  WHERE t.status IN ('paid', 'refunded')
) AS rows
WHERE eid IS NOT NULL;

CREATE TEMP TABLE _test_proposals ON COMMIT DROP AS
SELECT mmp.id
FROM public.mentor_meeting_proposals AS mmp
INNER JOIN _test_orders AS t
  ON t.mentor_id = mmp.mentor_id
 AND t.user_id = mmp.student_id
 AND t.package_id = mmp.package_id;

-- Görüşme teklifleri (review CASCADE)
DELETE FROM public.mentor_meeting_proposal_responses AS r
WHERE r.proposal_id IN (SELECT id FROM _test_proposals);

DELETE FROM public.mentor_meeting_proposal_options AS o
WHERE o.proposal_id IN (SELECT id FROM _test_proposals);

DELETE FROM public.mentor_meeting_proposals AS mmp
WHERE mmp.id IN (SELECT id FROM _test_proposals);

-- Görev aktivasyonları
DELETE FROM public.mentor_package_task_activations AS mpta
WHERE EXISTS (
  SELECT 1
  FROM _test_enrollments AS te
  INNER JOIN public.mentor_package_students AS mps ON mps.id = te.enrollment_id
  WHERE mpta.mentor_id = mps.mentor_id
    AND mpta.student_id = mps.student_id
    AND mpta.package_id = mps.package_id
);

-- Bildirimler (paket / kayıt)
DELETE FROM public.notifications AS n
WHERE n.enrollment_id IN (SELECT enrollment_id FROM _test_enrollments)
   OR (
     n.type IN (
       'mentor_package_purchased',
       'mentor_package_sale',
       'mentor_package_refund_requested',
       'mentor_package_refunded'
     )
     AND n.mentor_id IN (SELECT DISTINCT mentor_id FROM _test_orders)
   );

-- Öğrenci referral kredileri
DELETE FROM public.student_referral_credits AS src
WHERE src.source_order_id IN (SELECT id FROM _test_orders)
   OR src.reserved_order_id IN (SELECT id FROM _test_orders)
   OR src.used_order_id IN (SELECT id FROM _test_orders);

-- Influencer cüzdan (paket komisyonu)
DELETE FROM public.influencer_wallet_ledger AS iwl
WHERE iwl.package_order_id IN (SELECT id FROM _test_orders);

-- Mentör cüzdan hareketleri
DELETE FROM public.mentor_wallet_ledger AS mwl
WHERE mwl.package_order_id IN (SELECT id FROM _test_orders);

-- Test döneminden kalan payout talepleri (varsa)
DELETE FROM public.mentor_payout_requests AS mpr
WHERE NOT EXISTS (
  SELECT 1
  FROM public.mentor_wallet_ledger AS mwl
  WHERE mwl.mentor_id = mpr.mentor_id
    AND mwl.entry_type = 'package_sale'
    AND (
      mwl.package_order_id IS NULL
      OR mwl.package_order_id NOT IN (SELECT id FROM _test_orders)
    )
);

-- Kayıtlar (ödeme kaynaklı)
DELETE FROM public.mentor_package_students AS mps
WHERE mps.id IN (SELECT enrollment_id FROM _test_enrollments);

-- Siparişler
DELETE FROM public.package_orders AS po
WHERE po.id IN (SELECT id FROM _test_orders);

COMMIT;

-- Doğrulama
SELECT 'package_orders_remaining' AS label, COUNT(*) AS cnt FROM public.package_orders;
SELECT 'mentor_wallet_net' AS label, coalesce(round(sum(net_amount)::numeric, 2), 0) AS total
FROM public.mentor_wallet_ledger;
SELECT 'mentor_package_students' AS label, COUNT(*) AS cnt FROM public.mentor_package_students;
