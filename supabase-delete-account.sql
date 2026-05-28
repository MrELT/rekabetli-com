-- Hesap silme RPC'si (kullanici kendi hesabini kalici siler)
-- Supabase SQL Editor'da bir kez calistirin.

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Kullaniciya bagli satirlar (tablo varsa sil)
  IF to_regclass('public.post_saves') IS NOT NULL THEN
    DELETE FROM public.post_saves WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.post_likes') IS NOT NULL THEN
    DELETE FROM public.post_likes WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.comment_ratings') IS NOT NULL THEN
    DELETE FROM public.comment_ratings WHERE rater_user_id = v_uid;
  END IF;

  IF to_regclass('public.comments') IS NOT NULL THEN
    DELETE FROM public.comments WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.posts') IS NOT NULL THEN
    DELETE FROM public.posts WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.community_join_requests') IS NOT NULL THEN
    DELETE FROM public.community_join_requests WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.community_members') IS NOT NULL THEN
    DELETE FROM public.community_members WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.communities') IS NOT NULL THEN
    DELETE FROM public.communities WHERE owner_id = v_uid;
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.mentor_applications') IS NOT NULL THEN
    DELETE FROM public.mentor_applications WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.mentorship_requests') IS NOT NULL THEN
    DELETE FROM public.mentorship_requests WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.daily_image_uploads') IS NOT NULL THEN
    DELETE FROM public.daily_image_uploads WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.image_upload_log') IS NOT NULL THEN
    DELETE FROM public.image_upload_log WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.admin_users') IS NOT NULL THEN
    DELETE FROM public.admin_users WHERE user_id = v_uid;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = v_uid;
  END IF;

  -- Avatar dosyalari
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'avatars'
      AND (storage.foldername(name))[1] = v_uid::text;
  END IF;

  -- Son adim: auth kullanicisini sil
  DELETE FROM auth.users WHERE id = v_uid;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
