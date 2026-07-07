-- Kalan güvenlik sıkılaştırmaları: tutar doğrulama, metin sanitizasyonu, API rate limit
-- supabase-security-payout-admin-only.sql sonrasında çalıştırın.

CREATE OR REPLACE FUNCTION public.strip_markup_from_text (p_text text, p_max_len integer DEFAULT 10000)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_text IS NULL THEN NULL
    ELSE left(
      regexp_replace(
        regexp_replace(btrim(p_text), '<[^>]*>', '', 'g'),
        '[[:cntrl:]]',
        '',
        'g'
      ),
      greatest(coalesce(p_max_len, 10000), 1)
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.sanitize_profile_text_fields ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.display_name IS NOT NULL THEN
    NEW.display_name := public.strip_markup_from_text(NEW.display_name, 120);
  END IF;

  IF NEW.bio IS NOT NULL THEN
    NEW.bio := public.strip_markup_from_text(NEW.bio, 3000);
  END IF;

  IF NEW.city IS NOT NULL THEN
    NEW.city := public.strip_markup_from_text(NEW.city, 120);
  END IF;

  IF NEW.school IS NOT NULL THEN
    NEW.school := public.strip_markup_from_text(NEW.school, 120);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sanitize_text_fields ON public.profiles;

CREATE TRIGGER profiles_sanitize_text_fields
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sanitize_profile_text_fields ();

CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  hit_count integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.assert_api_rate_limit (
  p_bucket_key text,
  p_max_hits integer DEFAULT 20,
  p_window_seconds integer DEFAULT 3600
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit_count integer;
BEGIN
  IF p_bucket_key IS NULL OR btrim(p_bucket_key) = '' THEN
    RETURN;
  END IF;

  IF p_max_hits IS NULL OR p_max_hits <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.api_rate_limit_buckets AS b (bucket_key, hit_count, window_start)
  VALUES (btrim(p_bucket_key), 1, now())
  ON CONFLICT (bucket_key) DO UPDATE
  SET
    hit_count = CASE
      WHEN b.window_start + make_interval(secs => greatest(p_window_seconds, 1)) <= now() THEN 1
      ELSE b.hit_count + 1
    END,
    window_start = CASE
      WHEN b.window_start + make_interval(secs => greatest(p_window_seconds, 1)) <= now() THEN now()
      ELSE b.window_start
    END
  RETURNING hit_count INTO v_hit_count;

  IF v_hit_count > p_max_hits THEN
    RAISE EXCEPTION 'rate_limit_exceeded';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_api_rate_limit (text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_api_rate_limit (text, integer, integer) TO service_role;

REVOKE ALL ON TABLE public.api_rate_limit_buckets FROM PUBLIC;

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
    public.strip_markup_from_text(p_display_label, 120),
    public.strip_markup_from_text(p_social_platform, 80),
    public.strip_markup_from_text(p_social_handle, 120),
    public.strip_markup_from_text(p_follower_range, 80),
    public.strip_markup_from_text(p_application_note, 2000),
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
  v_wallet_ledger_id uuid;
  v_gross numeric;
  v_expected numeric;
  v_student_credit_id uuid;
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

  v_expected := round(v_order.list_price - coalesce(v_order.referral_credit_applied, 0), 2);

  IF p_amount_paid IS NOT NULL THEN
    v_gross := round(p_amount_paid, 2);
    IF abs(v_gross - v_expected) > 0.02 THEN
      RAISE EXCEPTION 'package_order_amount_mismatch';
    END IF;
  ELSE
    v_gross := v_expected;
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

      UPDATE public.package_orders
      SET enrollment_id = v_enrollment_id,
          updated_at = now()
      WHERE id = v_order.id;

      v_repaired := true;
    END IF;

    v_wallet_ledger_id := public.record_mentor_wallet_sale(v_order.id);
    PERFORM public.finalize_student_referral_credits_for_order(v_order.id);
    PERFORM public.record_student_referral_credit(v_order.id);

    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'status', v_order.status,
      'enrollment_id', coalesce(v_order.enrollment_id, v_enrollment_id),
      'wallet_ledger_id', v_wallet_ledger_id,
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
      PERFORM public.release_student_referral_credit_reservations(v_order.id);
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
      amount_paid = v_gross,
      stripe_checkout_session_id = COALESCE(v_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = COALESCE(v_payment_intent_id, stripe_payment_intent_id),
      enrollment_id = v_enrollment_id,
      paid_at = now(),
      updated_at = now()
  WHERE id = v_order.id;

  v_wallet_ledger_id := public.record_mentor_wallet_sale(v_order.id);
  PERFORM public.finalize_student_referral_credits_for_order(v_order.id);
  v_student_credit_id := public.record_student_referral_credit(v_order.id);

  IF NOT v_already_enrolled THEN
    v_student_label := coalesce(public.notification_actor_label(v_order.user_id), 'Öğrenci');
    v_mentor_label := coalesce(public.notification_actor_label(v_order.mentor_id), 'Mentör');

    INSERT INTO public.notifications (
      user_id,
      actor_id,
      actor_name,
      type,
      mentor_id,
      enrollment_id,
      body_text
    )
    VALUES (
      v_order.mentor_id,
      v_order.user_id,
      v_student_label,
      'mentor_package_sale',
      v_order.mentor_id,
      v_enrollment_id,
      v_student_label || ' · ' || v_order.package_title
        || ' paketinizi satın aldı. Lütfen en kısa sürede ilk görüşmenizi planlayın.'
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'status', 'paid',
    'enrollment_id', v_enrollment_id,
    'already_enrolled', v_already_enrolled,
    'wallet_ledger_id', v_wallet_ledger_id,
    'student_referral_credit_id', v_student_credit_id,
    'already_completed', false,
    'amount_paid', v_gross
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_package_purchase (uuid, text, text, numeric) TO service_role;
