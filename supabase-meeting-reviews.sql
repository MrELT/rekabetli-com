-- Görüşme sonrası öğrenci değerlendirmeleri (5 yıldız + yorum)
-- supabase-mentor-meeting-proposals.sql sonrasında çalıştırın.

CREATE TABLE IF NOT EXISTS public.mentor_meeting_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL UNIQUE REFERENCES public.mentor_meeting_proposals (id) ON DELETE CASCADE,
  mentor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  package_id text NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 800),
  masked_student_name text NOT NULL DEFAULT '',
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mentor_meeting_reviews_mentor_package_idx
ON public.mentor_meeting_reviews (mentor_id, package_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mentor_meeting_reviews_student_idx
ON public.mentor_meeting_reviews (student_id, created_at DESC);

ALTER TABLE public.mentor_meeting_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_meeting_reviews_select_own_or_public" ON public.mentor_meeting_reviews;
CREATE POLICY "mentor_meeting_reviews_select_own_or_public"
ON public.mentor_meeting_reviews
FOR SELECT
TO authenticated
USING (
  auth.uid () = student_id
  OR auth.uid () = mentor_id
  OR is_public = true
  OR public.is_admin_user(auth.uid ())
);

DROP POLICY IF EXISTS "mentor_meeting_reviews_select_public_anon" ON public.mentor_meeting_reviews;
CREATE POLICY "mentor_meeting_reviews_select_public_anon"
ON public.mentor_meeting_reviews
FOR SELECT
TO anon
USING (is_public = true);

DROP POLICY IF EXISTS "mentor_meeting_reviews_insert_student" ON public.mentor_meeting_reviews;
CREATE POLICY "mentor_meeting_reviews_insert_student"
ON public.mentor_meeting_reviews
FOR INSERT
TO authenticated
WITH CHECK (auth.uid () = student_id);

DROP POLICY IF EXISTS "mentor_meeting_reviews_update_student" ON public.mentor_meeting_reviews;
CREATE POLICY "mentor_meeting_reviews_update_student"
ON public.mentor_meeting_reviews
FOR UPDATE
TO authenticated
USING (auth.uid () = student_id)
WITH CHECK (auth.uid () = student_id);

CREATE OR REPLACE FUNCTION public.mask_person_display_name (p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_parts text[];
  v_result text := '';
  v_part text;
  v_i integer;
BEGIN
  v_parts := regexp_split_to_array(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), ' ');
  IF v_parts IS NULL OR array_length(v_parts, 1) IS NULL THEN
    RETURN 'Kullanıcı';
  END IF;

  FOR v_i IN 1..array_length(v_parts, 1) LOOP
    v_part := btrim(coalesce(v_parts[v_i], ''));
    IF v_part = '' THEN
      CONTINUE;
    END IF;
    IF v_result <> '' THEN
      v_result := v_result || ' ';
    END IF;
    v_result := v_result || left(v_part, 1) || '****';
  END LOOP;

  RETURN coalesce(nullif(v_result, ''), 'Kullanıcı');
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_student_meeting_review (
  p_proposal_id uuid,
  p_rating integer,
  p_comment text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_proposal public.mentor_meeting_proposals%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_comment text := left(btrim(coalesce(p_comment, '')), 800);
  v_row public.mentor_meeting_reviews%ROWTYPE;
BEGIN
  IF v_student_id IS NULL OR p_proposal_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'invalid_rating';
  END IF;

  SELECT *
  INTO v_proposal
  FROM public.mentor_meeting_proposals AS mp
  WHERE mp.id = p_proposal_id
    AND mp.student_id = v_student_id
    AND mp.status = 'confirmed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;

  IF v_proposal.scheduled_starts_at IS NULL OR v_proposal.scheduled_starts_at > now() THEN
    RAISE EXCEPTION 'meeting_not_completed';
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = v_student_id;

  INSERT INTO public.mentor_meeting_reviews (
    proposal_id,
    mentor_id,
    student_id,
    package_id,
    rating,
    comment,
    masked_student_name,
    is_public
  )
  VALUES (
    v_proposal.id,
    v_proposal.mentor_id,
    v_student_id,
    v_proposal.package_id,
    p_rating,
    v_comment,
    public.mask_person_display_name(v_profile.display_name),
    true
  )
  ON CONFLICT (proposal_id)
  DO UPDATE SET
    rating = EXCLUDED.rating,
    comment = EXCLUDED.comment,
    masked_student_name = EXCLUDED.masked_student_name,
    is_public = true,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'proposal_id', v_row.proposal_id,
    'rating', v_row.rating,
    'comment', v_row.comment,
    'masked_student_name', v_row.masked_student_name,
    'reviewed_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_student_meeting_review (uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_meeting_review (uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_student_meeting_review (p_proposal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_row public.mentor_meeting_reviews%ROWTYPE;
BEGIN
  IF v_student_id IS NULL OR p_proposal_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;

  SELECT *
  INTO v_row
  FROM public.mentor_meeting_reviews AS mr
  WHERE mr.proposal_id = p_proposal_id
    AND mr.student_id = v_student_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'proposal_id', v_row.proposal_id,
    'rating', v_row.rating,
    'comment', v_row.comment,
    'masked_student_name', v_row.masked_student_name,
    'reviewed_at', coalesce(v_row.updated_at, v_row.created_at)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_meeting_review (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_meeting_review (uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_package_public_reviews (
  p_mentor_id uuid,
  p_package_id text,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT
      mr.rating,
      mr.comment,
      mr.masked_student_name,
      mr.updated_at
    FROM public.mentor_meeting_reviews AS mr
    WHERE mr.mentor_id = p_mentor_id
      AND mr.package_id = btrim(coalesce(p_package_id, ''))
      AND mr.is_public = true
    ORDER BY mr.updated_at DESC
    LIMIT greatest(coalesce(p_limit, 20), 1)
  )
  SELECT jsonb_build_object(
    'average_rating', coalesce((SELECT round(avg(rating)::numeric, 2) FROM rows), 0),
    'review_count', (SELECT count(*) FROM rows),
    'reviews', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'rating', r.rating,
            'comment', r.comment,
            'masked_student_name', r.masked_student_name,
            'reviewed_at', r.updated_at
          )
        )
        FROM rows AS r
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_package_public_reviews (uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_package_public_reviews (uuid, text, integer) TO anon, authenticated;
