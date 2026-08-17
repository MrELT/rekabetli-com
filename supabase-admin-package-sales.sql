-- Admin: satılan paketlerin kayıt / ilk görüşme / yorum durumu
-- supabase-package-orders.sql, supabase-mentor-package-enrollments.sql,
-- supabase-mentor-meeting-proposals.sql ve supabase-meeting-reviews.sql sonrasında çalıştırın.

CREATE OR REPLACE FUNCTION public.get_admin_package_sales ()
RETURNS TABLE (
  order_id uuid,
  order_status text,
  package_title text,
  amount_paid numeric,
  list_price numeric,
  platform_fee numeric,
  currency text,
  paid_at timestamptz,
  created_at timestamptz,
  mentor_name text,
  student_name text,
  in_panel boolean,
  enrolled_at timestamptz,
  unenrolled_at timestamptz,
  meeting_status text,
  meeting_at timestamptz,
  meeting_confirmed_at timestamptz,
  review_rating integer,
  review_comment text,
  review_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user (auth.uid ()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  RETURN QUERY
  SELECT
    po.id AS order_id,
    po.status AS order_status,
    po.package_title AS package_title,
    po.amount_paid AS amount_paid,
    po.list_price AS list_price,
    po.platform_fee AS platform_fee,
    po.currency AS currency,
    po.paid_at AS paid_at,
    po.created_at AS created_at,
    coalesce(public.notification_actor_label (po.mentor_id), 'Mentör') AS mentor_name,
    coalesce(public.notification_actor_label (po.user_id), 'Öğrenci') AS student_name,
    (mps.id IS NOT NULL AND mps.unenrolled_at IS NULL) AS in_panel,
    mps.created_at AS enrolled_at,
    mps.unenrolled_at AS unenrolled_at,
    coalesce(meeting.status, 'none') AS meeting_status,
    meeting.scheduled_starts_at AS meeting_at,
    meeting.confirmed_at AS meeting_confirmed_at,
    review.rating AS review_rating,
    NULLIF(btrim(review.comment), '') AS review_comment,
    review.created_at AS review_at
  FROM public.package_orders AS po
  LEFT JOIN public.mentor_package_students AS mps
    ON mps.mentor_id = po.mentor_id
   AND mps.student_id = po.user_id
   AND mps.package_id = po.package_id
  LEFT JOIN LATERAL (
    SELECT
      mmp.id,
      mmp.status,
      mmp.scheduled_starts_at,
      mmp.confirmed_at
    FROM public.mentor_meeting_proposals AS mmp
    WHERE mmp.mentor_id = po.mentor_id
      AND mmp.student_id = po.user_id
      AND mmp.package_id = po.package_id
    ORDER BY
      CASE WHEN mmp.status = 'confirmed' THEN 0 ELSE 1 END,
      mmp.scheduled_starts_at ASC NULLS LAST,
      mmp.created_at DESC
    LIMIT 1
  ) AS meeting ON true
  LEFT JOIN public.mentor_meeting_reviews AS review
    ON review.proposal_id = meeting.id
  WHERE po.status IN ('paid', 'refunded')
  ORDER BY po.paid_at DESC NULLS LAST, po.created_at DESC
  LIMIT 300;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_package_sales () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_package_sales () TO authenticated;

COMMENT ON FUNCTION public.get_admin_package_sales () IS
  'Admin satış listesi: panel kaydı, ilk görüşme ve varsa görüşme yorumu.';
