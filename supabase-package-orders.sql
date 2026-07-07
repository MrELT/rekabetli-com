-- Paket ödemeleri (Stripe Checkout) — sipariş kaydı ve ödeme sonrası kayıt
-- Ön koşul: supabase-package-requests.sql, supabase-mentor-package-enrollments.sql,
--            supabase-mentor-vitrin-availability.sql, supabase-mentor-notifications.sql
-- Stripe Edge Function'ları (Adım 2) bu tabloyu ve RPC'leri kullanır.

CREATE TABLE IF NOT EXISTS public.package_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  mentor_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  package_id text NOT NULL,
  package_title text NOT NULL,
  list_price numeric(12, 2) NOT NULL,
  amount_paid numeric(12, 2),
  currency text NOT NULL DEFAULT 'try',
  platform_fee numeric(12, 2),
  stripe_fee numeric(12, 2),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  enrollment_id uuid REFERENCES public.mentor_package_students (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_orders_no_self CHECK (user_id <> mentor_id),
  CONSTRAINT package_orders_package_id_format CHECK (
    char_length(package_id) BETWEEN 1 AND 64
    AND package_id ~ '^[a-zA-Z0-9_-]+$'
  ),
  CONSTRAINT package_orders_package_title_len CHECK (
    char_length(trim(package_title)) BETWEEN 1 AND 120
  ),
  CONSTRAINT package_orders_list_price_positive CHECK (list_price > 0),
  CONSTRAINT package_orders_amount_paid_positive CHECK (
    amount_paid IS NULL OR amount_paid > 0
  ),
  CONSTRAINT package_orders_currency_len CHECK (
    char_length(trim(currency)) BETWEEN 3 AND 8
  ),
  CONSTRAINT package_orders_status_check CHECK (
    status IN ('pending', 'paid', 'failed', 'expired', 'canceled', 'refunded')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS package_orders_stripe_session_uidx
ON public.package_orders (stripe_checkout_session_id)
WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS package_orders_user_created_idx
ON public.package_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS package_orders_mentor_created_idx
ON public.package_orders (mentor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS package_orders_status_expires_idx
ON public.package_orders (status, expires_at)
WHERE status = 'pending';

COMMENT ON TABLE public.package_orders IS
  'Mentör vitrin paketleri için Stripe ödeme siparişleri.';

ALTER TABLE public.package_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "package_orders_select_own" ON public.package_orders;
CREATE POLICY "package_orders_select_own"
ON public.package_orders
FOR SELECT
TO authenticated
USING (auth.uid () = user_id);

DROP POLICY IF EXISTS "package_orders_select_mentor" ON public.package_orders;
CREATE POLICY "package_orders_select_mentor"
ON public.package_orders
FOR SELECT
TO authenticated
USING (auth.uid () = mentor_id);

DROP POLICY IF EXISTS "package_orders_select_admin" ON public.package_orders;
CREATE POLICY "package_orders_select_admin"
ON public.package_orders
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (
  type IN (
    'comment',
    'like',
    'community_join_request',
    'community_join_rejected',
    'community_post',
    'mentor_package_request',
    'mentor_package_purchased',
    'mentor_package_sale',
    'mentor_student_message',
    'mentor_mentor_reply',
    'mentor_meeting_proposal',
    'mentor_meeting_confirmed',
    'mentor_meeting_postpone',
    'mentor_meeting_postpone_accepted',
    'mentor_meeting_refund_requested',
    'mentor_meeting_reminder_1d',
    'mentor_meeting_reminder_30m',
    'mentor_vitrin_active',
    'answer_reply'
  )
) NOT VALID;

CREATE OR REPLACE FUNCTION public.count_package_capacity_usage (
  p_mentor_id uuid,
  p_package_id text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(src.cnt), 0)::integer
  FROM (
    SELECT COUNT(*)::integer AS cnt
    FROM public.package_requests AS pr
    WHERE pr.mentor_id = p_mentor_id
      AND pr.package_id = p_package_id
      AND pr.status IN ('pending', 'reviewing', 'contacted')

    UNION ALL

    SELECT COUNT(*)::integer AS cnt
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
      AND mps.package_id = p_package_id

    UNION ALL

    SELECT COUNT(*)::integer AS cnt
    FROM public.package_orders AS po
    WHERE po.mentor_id = p_mentor_id
      AND po.package_id = p_package_id
      AND po.status = 'pending'
      AND (po.expires_at IS NULL OR po.expires_at > now())
  ) AS src;
$$;

REVOKE ALL ON FUNCTION public.count_package_capacity_usage (uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.resolve_mentor_package_offer (
  p_mentor_id uuid,
  p_package_id text,
  OUT package_title text,
  OUT list_price numeric,
  OUT package_capacity integer
)
RETURNS record
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_id text := btrim(coalesce(p_package_id, ''));
BEGIN
  IF p_mentor_id IS NULL
    OR v_package_id = ''
    OR char_length(v_package_id) > 64
    OR v_package_id !~ '^[a-zA-Z0-9_-]+$' THEN
    RETURN;
  END IF;

  SELECT
    left(btrim(coalesce(pkg ->> 'title', 'Paket')), 120),
    NULLIF(pkg ->> 'price', '')::numeric,
    NULLIF(pkg ->> 'capacity', '')::integer
  INTO package_title, list_price, package_capacity
  FROM public.mentor_pages AS mp
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(mp.packages) = 'array' THEN mp.packages
      ELSE '[]'::jsonb
    END
  ) AS pkg
  WHERE mp.user_id = p_mentor_id
    AND pkg ->> 'id' = v_package_id
    AND btrim(coalesce(pkg ->> 'title', '')) <> ''
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_mentor_package_offer (uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_package_order (
  p_mentor_id uuid,
  p_package_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_package_id text := btrim(coalesce(p_package_id, ''));
  v_title text;
  v_price numeric;
  v_capacity integer;
  v_usage integer;
  v_order_id uuid;
  v_expires_at timestamptz := now() + interval '30 minutes';
  v_mentor_name text;
  v_already_enrolled boolean := false;
BEGIN
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF p_mentor_id IS NULL OR p_mentor_id = v_student_id THEN
    RAISE EXCEPTION 'package_order_self_not_allowed';
  END IF;

  IF v_package_id = ''
    OR char_length(v_package_id) > 64
    OR v_package_id !~ '^[a-zA-Z0-9_-]+$' THEN
    RAISE EXCEPTION 'package_order_invalid_package';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_mentor_id
      AND p.is_mentor = true
  ) THEN
    RAISE EXCEPTION 'package_order_invalid_mentor';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_pages AS mp
    WHERE mp.user_id = p_mentor_id
      AND COALESCE(mp.vitrin_active, true) = true
  ) THEN
    RAISE EXCEPTION 'package_order_mentor_unavailable';
  END IF;

  SELECT offer.package_title, offer.list_price, offer.package_capacity
  INTO v_title, v_price, v_capacity
  FROM public.resolve_mentor_package_offer(p_mentor_id, v_package_id) AS offer;

  IF v_title IS NULL OR v_price IS NULL OR v_price <= 0 THEN
    RAISE EXCEPTION 'package_order_package_not_found';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
      AND mps.student_id = v_student_id
      AND mps.package_id = v_package_id
  )
  INTO v_already_enrolled;

  IF v_capacity IS NOT NULL AND v_capacity > 0 AND NOT v_already_enrolled THEN
    v_usage := public.count_package_capacity_usage(p_mentor_id, v_package_id);
    IF v_usage >= v_capacity THEN
      RAISE EXCEPTION 'package_order_capacity_full';
    END IF;
  END IF;

  UPDATE public.package_orders AS po
  SET status = 'canceled',
      updated_at = now()
  WHERE po.user_id = v_student_id
    AND po.mentor_id = p_mentor_id
    AND po.package_id = v_package_id
    AND po.status = 'pending';

  INSERT INTO public.package_orders (
    user_id,
    mentor_id,
    package_id,
    package_title,
    list_price,
    currency,
    status,
    expires_at
  )
  VALUES (
    v_student_id,
    p_mentor_id,
    v_package_id,
    v_title,
    round(v_price, 2),
    'try',
    'pending',
    v_expires_at
  )
  RETURNING id INTO v_order_id;

  SELECT coalesce(public.notification_actor_label(p_mentor_id), 'Mentör')
  INTO v_mentor_name;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'mentor_id', p_mentor_id,
    'mentor_name', v_mentor_name,
    'package_id', v_package_id,
    'package_title', v_title,
    'list_price', round(v_price, 2),
    'currency', 'try',
    'amount_minor', (round(v_price, 2) * 100)::bigint,
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_package_order (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_package_order (uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_package_order_checkout_session (
  p_order_id uuid,
  p_stripe_checkout_session_id text,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id text := btrim(coalesce(p_stripe_checkout_session_id, ''));
BEGIN
  IF p_order_id IS NULL OR v_session_id = '' THEN
    RAISE EXCEPTION 'package_order_invalid_session';
  END IF;

  UPDATE public.package_orders AS po
  SET stripe_checkout_session_id = v_session_id,
      expires_at = COALESCE(p_expires_at, po.expires_at),
      updated_at = now()
  WHERE po.id = p_order_id
    AND po.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_order_not_pending';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_package_order_checkout_session (uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_package_order_checkout_session (uuid, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_mentor_package_enrollment (
  p_mentor_id uuid,
  p_student_id uuid,
  p_package_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package_id text := btrim(coalesce(p_package_id, ''));
  v_enrollment_id uuid;
  v_already_enrolled boolean := false;
BEGIN
  IF p_mentor_id IS NULL OR p_student_id IS NULL OR p_mentor_id = p_student_id THEN
    RAISE EXCEPTION 'package_enrollment_invalid';
  END IF;

  IF v_package_id = ''
    OR char_length(v_package_id) > 64
    OR v_package_id !~ '^[a-zA-Z0-9_-]+$' THEN
    RAISE EXCEPTION 'package_enrollment_invalid_package';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = p_student_id
  ) THEN
    RAISE EXCEPTION 'student_profile_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
      AND mps.student_id = p_student_id
      AND mps.package_id = v_package_id
  ) THEN
    SELECT mps.id
    INTO v_enrollment_id
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
      AND mps.student_id = p_student_id
      AND mps.package_id = v_package_id
    LIMIT 1;

    v_already_enrolled := true;
  ELSE
    INSERT INTO public.mentor_linked_students (mentor_id, student_id)
    VALUES (p_mentor_id, p_student_id)
    ON CONFLICT ON CONSTRAINT mentor_linked_students_pair_unique DO NOTHING;

    INSERT INTO public.mentor_package_students (mentor_id, student_id, package_id)
    VALUES (p_mentor_id, p_student_id, v_package_id)
    ON CONFLICT ON CONSTRAINT mentor_package_students_unique DO NOTHING
    RETURNING id INTO v_enrollment_id;

    IF v_enrollment_id IS NULL THEN
      SELECT mps.id
      INTO v_enrollment_id
      FROM public.mentor_package_students AS mps
      WHERE mps.mentor_id = p_mentor_id
        AND mps.student_id = p_student_id
        AND mps.package_id = v_package_id
      LIMIT 1;

      v_already_enrolled := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'enrollment_id', v_enrollment_id,
    'already_enrolled', v_already_enrolled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_mentor_package_enrollment (uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_mentor_package_enrollment (uuid, uuid, text) TO service_role;

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
      v_already_enrolled := coalesce((v_enrollment ->> 'already_enrolled')::boolean, false);

      UPDATE public.package_orders
      SET enrollment_id = v_enrollment_id,
          updated_at = now()
      WHERE id = v_order.id;

      v_repaired := true;
    END IF;

    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'enrollment_id', coalesce(v_order.enrollment_id, v_enrollment_id),
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

  UPDATE public.package_orders
  SET status = 'paid',
      amount_paid = COALESCE(p_amount_paid, list_price),
      stripe_checkout_session_id = COALESCE(v_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = COALESCE(v_payment_intent_id, stripe_payment_intent_id),
      enrollment_id = v_enrollment_id,
      paid_at = now(),
      updated_at = now()
  WHERE id = v_order.id;

  IF NOT v_already_enrolled THEN
    v_student_label := coalesce(public.notification_actor_label(v_order.user_id), 'Öğrenci');
    v_mentor_label := coalesce(public.notification_actor_label(v_order.mentor_id), 'Mentör');

    INSERT INTO public.notifications (
      user_id,
      actor_id,
      actor_name,
      type,
      mentor_id,
      body_text
    )
    VALUES (
      v_order.user_id,
      v_order.mentor_id,
      v_mentor_label,
      'mentor_package_purchased',
      v_order.mentor_id,
      v_mentor_label || ' · ' || v_order.package_title || ' paketini satın aldınız.'
    );

    INSERT INTO public.notifications (
      user_id,
      actor_id,
      actor_name,
      type,
      mentor_id,
      body_text
    )
    VALUES (
      v_order.mentor_id,
      v_order.user_id,
      v_student_label,
      'mentor_package_sale',
      v_order.mentor_id,
      v_student_label || ' · ' || v_order.package_title || ' paketinizi satın aldı.'
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', 'paid',
    'enrollment_id', v_enrollment_id,
    'already_completed', false,
    'already_enrolled', v_already_enrolled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_package_order_by_session (
  p_stripe_checkout_session_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id text := btrim(coalesce(p_stripe_checkout_session_id, ''));
BEGIN
  IF v_session_id = '' THEN
    RAISE EXCEPTION 'package_order_invalid_session';
  END IF;

  UPDATE public.package_orders
  SET status = 'expired',
      updated_at = now()
  WHERE stripe_checkout_session_id = v_session_id
    AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.expire_package_order_by_session (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_package_order_by_session (text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_package_order_by_checkout_session (
  p_stripe_checkout_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id text := btrim(coalesce(p_stripe_checkout_session_id, ''));
  v_row public.package_orders%ROWTYPE;
BEGIN
  IF v_session_id = '' THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_row
  FROM public.package_orders AS po
  WHERE po.stripe_checkout_session_id = v_session_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_row.id,
    'user_id', v_row.user_id,
    'mentor_id', v_row.mentor_id,
    'package_id', v_row.package_id,
    'package_title', v_row.package_title,
    'list_price', v_row.list_price,
    'amount_paid', v_row.amount_paid,
    'currency', v_row.currency,
    'status', v_row.status,
    'enrollment_id', v_row.enrollment_id,
    'paid_at', v_row.paid_at,
    'expires_at', v_row.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_package_order_by_checkout_session (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_package_order_by_checkout_session (text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_package_order_status (p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_row public.package_orders%ROWTYPE;
BEGIN
  IF v_student_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT *
  INTO v_row
  FROM public.package_orders AS po
  WHERE po.id = p_order_id
    AND po.user_id = v_student_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_order_not_found';
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_row.id,
    'mentor_id', v_row.mentor_id,
    'package_id', v_row.package_id,
    'package_title', v_row.package_title,
    'list_price', v_row.list_price,
    'amount_paid', v_row.amount_paid,
    'currency', v_row.currency,
    'status', v_row.status,
    'enrollment_id', v_row.enrollment_id,
    'paid_at', v_row.paid_at,
    'expires_at', v_row.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_package_order_status (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_package_order_status (uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_mentor_package_fill_counts (p_mentor_id uuid)
RETURNS TABLE (package_id text, fill_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    combined.package_id,
    SUM(combined.cnt)::integer AS fill_count
  FROM (
    SELECT
      pr.package_id,
      COUNT(*)::integer AS cnt
    FROM public.package_requests AS pr
    WHERE pr.mentor_id = p_mentor_id
      AND pr.status IN ('pending', 'reviewing', 'contacted')
    GROUP BY pr.package_id

    UNION ALL

    SELECT
      mps.package_id,
      COUNT(*)::integer AS cnt
    FROM public.mentor_package_students AS mps
    WHERE mps.mentor_id = p_mentor_id
    GROUP BY mps.package_id

    UNION ALL

    SELECT
      po.package_id,
      COUNT(*)::integer AS cnt
    FROM public.package_orders AS po
    WHERE po.mentor_id = p_mentor_id
      AND po.status = 'pending'
      AND (po.expires_at IS NULL OR po.expires_at > now())
    GROUP BY po.package_id
  ) AS combined
  GROUP BY combined.package_id;
$$;

REVOKE ALL ON FUNCTION public.get_mentor_package_fill_counts (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mentor_package_fill_counts (uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.create_package_order (uuid, text) IS
  'Öğrenci için pending paket siparişi oluşturur (Stripe Checkout öncesi).';
COMMENT ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) IS
  'Stripe webhook: ödemeyi onaylar, öğrenciyi pakete kaydeder (idempotent).';
COMMENT ON FUNCTION public.set_package_order_checkout_session (uuid, text, timestamptz) IS
  'Edge Function: Stripe Checkout session kimliğini siparişe yazar.';
COMMENT ON FUNCTION public.get_package_order_status (uuid) IS
  'Öğrenci kendi sipariş durumunu okur (başarı sayfası polling).';
