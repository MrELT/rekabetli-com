-- İçerik raporları (gönderi / yorum)
-- Site içi bildirimler + admin paneli. Supabase SQL Editor'da bir kez çalıştırın.

CREATE TABLE IF NOT EXISTS public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  post_id uuid REFERENCES public.posts (id) ON DELETE SET NULL,
  comment_id uuid REFERENCES public.comments (id) ON DELETE SET NULL,
  community_id uuid REFERENCES public.communities (id) ON DELETE SET NULL,
  target_author_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  target_author_name text,
  target_snippet text,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'removed', 'dismissed')),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_target_shape CHECK (
    (target_type = 'post' AND post_id IS NOT NULL AND comment_id IS NULL)
    OR (target_type = 'comment' AND comment_id IS NOT NULL)
  ),
  CONSTRAINT content_reports_reason_len
    CHECK (char_length(reason) <= 2000)
);

CREATE UNIQUE INDEX IF NOT EXISTS content_reports_one_pending_post
ON public.content_reports (reporter_id, post_id)
WHERE status = 'pending' AND target_type = 'post' AND post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS content_reports_one_pending_comment
ON public.content_reports (reporter_id, comment_id)
WHERE status = 'pending' AND target_type = 'comment' AND comment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_reports_status_created_idx
ON public.content_reports (status, created_at DESC);

COMMENT ON TABLE public.content_reports IS
  'Kullanıcıların gönderi/yorum raporları; admin inceleyip kaldırabilir.';

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_reports_select_admin" ON public.content_reports;
CREATE POLICY "content_reports_select_admin"
ON public.content_reports
FOR SELECT
TO authenticated
USING (public.is_admin_user(auth.uid()) OR reporter_id = auth.uid());

-- Bildirim tipi
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
    'answer_reply',
    'mentor_package_purchased',
    'mentor_package_sale',
    'mentor_package_refund_requested',
    'mentor_package_refunded',
    'admin_mentor_vitrin_review',
    'mentor_vitrin_review_approved',
    'mentor_vitrin_review_rejected',
    'content_report_resolved'
  )
) NOT VALID;

CREATE OR REPLACE FUNCTION public.submit_content_report (
  p_target_type text,
  p_post_id uuid DEFAULT NULL,
  p_comment_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_type text := lower(btrim(coalesce(p_target_type, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_report_id uuid;
  v_post public.posts%ROWTYPE;
  v_comment public.comments%ROWTYPE;
  v_author_id uuid;
  v_author_name text;
  v_snippet text;
  v_community_id uuid;
  v_post_id uuid;
  v_recent_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  IF v_type NOT IN ('post', 'comment') THEN
    RAISE EXCEPTION 'content_report_invalid_target';
  END IF;

  IF char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'content_report_reason_too_long';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_recent_count
  FROM public.content_reports AS cr
  WHERE cr.reporter_id = v_user_id
    AND cr.created_at >= now() - interval '1 hour';

  IF v_recent_count >= 15 THEN
    RAISE EXCEPTION 'content_report_rate_limited';
  END IF;

  IF v_type = 'post' THEN
    IF p_post_id IS NULL THEN
      RAISE EXCEPTION 'content_report_post_required';
    END IF;

    SELECT * INTO v_post
    FROM public.posts
    WHERE id = p_post_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'content_report_not_found';
    END IF;

    IF v_post.user_id = v_user_id THEN
      RAISE EXCEPTION 'content_report_own_content';
    END IF;

    v_author_id := v_post.user_id;
    v_author_name := coalesce(NULLIF(btrim(v_post.author), ''), 'Kullanıcı');
    v_snippet := left(coalesce(NULLIF(btrim(v_post.title), ''), btrim(v_post.content), ''), 240);
    v_community_id := v_post.community_id;
    v_post_id := v_post.id;

    INSERT INTO public.content_reports (
      reporter_id,
      target_type,
      post_id,
      comment_id,
      community_id,
      target_author_id,
      target_author_name,
      target_snippet,
      reason
    )
    VALUES (
      v_user_id,
      'post',
      v_post_id,
      NULL,
      v_community_id,
      v_author_id,
      v_author_name,
      v_snippet,
      v_reason
    )
    RETURNING id INTO v_report_id;
  ELSE
    IF p_comment_id IS NULL THEN
      RAISE EXCEPTION 'content_report_comment_required';
    END IF;

    SELECT * INTO v_comment
    FROM public.comments
    WHERE id = p_comment_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'content_report_not_found';
    END IF;

    IF v_comment.user_id = v_user_id THEN
      RAISE EXCEPTION 'content_report_own_content';
    END IF;

    SELECT community_id INTO v_community_id
    FROM public.posts
    WHERE id = v_comment.post_id;

    v_author_id := v_comment.user_id;
    v_author_name := coalesce(NULLIF(btrim(v_comment.author), ''), 'Kullanıcı');
    v_snippet := left(btrim(coalesce(v_comment.content, '')), 240);
    v_post_id := v_comment.post_id;

    INSERT INTO public.content_reports (
      reporter_id,
      target_type,
      post_id,
      comment_id,
      community_id,
      target_author_id,
      target_author_name,
      target_snippet,
      reason
    )
    VALUES (
      v_user_id,
      'comment',
      v_post_id,
      v_comment.id,
      v_community_id,
      v_author_id,
      v_author_name,
      v_snippet,
      v_reason
    )
    RETURNING id INTO v_report_id;
  END IF;

  RETURN v_report_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'content_report_already_pending';
END;
$$;

REVOKE ALL ON FUNCTION public.submit_content_report (text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_content_report (text, uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_content_reports ()
RETURNS TABLE (
  id uuid,
  reporter_id uuid,
  reporter_name text,
  reporter_email text,
  target_type text,
  post_id uuid,
  comment_id uuid,
  community_id uuid,
  community_name text,
  target_author_id uuid,
  target_author_name text,
  target_snippet text,
  reason text,
  status text,
  created_at timestamptz,
  reviewed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  RETURN QUERY
  SELECT
    cr.id,
    cr.reporter_id,
    coalesce(
      NULLIF(btrim(rp.display_name), ''),
      NULLIF(btrim(rp.email), ''),
      'Kullanıcı'
    ) AS reporter_name,
    coalesce(NULLIF(btrim(rp.email), ''), '—') AS reporter_email,
    cr.target_type,
    cr.post_id,
    cr.comment_id,
    cr.community_id,
    coalesce(NULLIF(btrim(c.name), ''), '—') AS community_name,
    cr.target_author_id,
    coalesce(NULLIF(btrim(cr.target_author_name), ''), 'Kullanıcı') AS target_author_name,
    cr.target_snippet,
    cr.reason,
    cr.status,
    cr.created_at,
    cr.reviewed_at
  FROM public.content_reports AS cr
  LEFT JOIN public.profiles AS rp ON rp.id = cr.reporter_id
  LEFT JOIN public.communities AS c ON c.id = cr.community_id
  ORDER BY
    CASE WHEN cr.status = 'pending' THEN 0 ELSE 1 END,
    cr.created_at DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_content_reports () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_content_reports () TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_content_report (
  p_report_id uuid,
  p_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_report public.content_reports%ROWTYPE;
  v_body text;
  v_label text;
  v_author text;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin_user(v_admin_id) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  IF v_action NOT IN ('remove', 'dismiss') THEN
    RAISE EXCEPTION 'content_report_invalid_action';
  END IF;

  SELECT * INTO v_report
  FROM public.content_reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'content_report_not_found';
  END IF;

  IF v_report.status <> 'pending' THEN
    RAISE EXCEPTION 'content_report_already_resolved';
  END IF;

  IF v_action = 'dismiss' THEN
    UPDATE public.content_reports
    SET
      status = 'dismissed',
      reviewed_at = now(),
      reviewed_by = v_admin_id
    WHERE id = p_report_id;
    RETURN;
  END IF;

  -- remove
  IF v_report.target_type = 'post' AND v_report.post_id IS NOT NULL THEN
    DELETE FROM public.posts WHERE id = v_report.post_id;
    v_label := 'gönderiyi';
  ELSIF v_report.target_type = 'comment' AND v_report.comment_id IS NOT NULL THEN
    DELETE FROM public.comments WHERE id = v_report.comment_id;
    v_label := 'yorumu';
  ELSE
    -- Hedef zaten silinmiş olabilir; raporu yine de kapat.
    v_label := CASE
      WHEN v_report.target_type = 'comment' THEN 'yorumu'
      ELSE 'gönderiyi'
    END;
  END IF;

  UPDATE public.content_reports
  SET
    status = 'removed',
    reviewed_at = now(),
    reviewed_by = v_admin_id
  WHERE id = p_report_id;

  v_author := coalesce(NULLIF(btrim(v_report.target_author_name), ''), 'Kullanıcı');
  v_body := format(
    '%s hakkındaki raporunuzu inceledik ve topluluk kurallarına uymadığı için bu %s kaldırdık. İşbirliğiniz için teşekkür ederiz.',
    v_author,
    v_label
  );

  -- Bu raporlayan + aynı hedefteki diğer bekleyen raporlayanlar
  INSERT INTO public.notifications (
    user_id,
    actor_id,
    actor_name,
    type,
    body_text
  )
  SELECT DISTINCT
    cr.reporter_id,
    v_admin_id,
    'Rekabetli',
    'content_report_resolved',
    v_body
  FROM public.content_reports AS cr
  WHERE cr.id = p_report_id
     OR (
       cr.status = 'pending'
       AND (
         (v_report.target_type = 'post' AND cr.post_id = v_report.post_id)
         OR (v_report.target_type = 'comment' AND cr.comment_id = v_report.comment_id)
       )
     );

  UPDATE public.content_reports
  SET
    status = 'removed',
    reviewed_at = now(),
    reviewed_by = v_admin_id
  WHERE status = 'pending'
    AND id <> p_report_id
    AND (
      (v_report.target_type = 'post' AND post_id = v_report.post_id)
      OR (v_report.target_type = 'comment' AND comment_id = v_report.comment_id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_resolve_content_report (uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_resolve_content_report (uuid, text) TO authenticated;
