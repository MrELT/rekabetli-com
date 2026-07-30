-- Rapor açıklamasını opsiyonel yap
-- supabase-content-reports.sql sonrası / mevcut DB için.

ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_reason_len;

ALTER TABLE public.content_reports
  ADD CONSTRAINT content_reports_reason_len
  CHECK (char_length(reason) <= 2000);

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
