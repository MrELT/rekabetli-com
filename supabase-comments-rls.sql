-- comments tablosu: okuma, yazma ve kimlik doğrulama
-- supabase-comments-delete.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.comments
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- INSERT: user_id istemciden gelse bile trigger auth.uid() ile eşitler
CREATE OR REPLACE FUNCTION public.comments_assign_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'comments_auth_required';
  END IF;

  NEW.user_id := auth.uid();

  SELECT nullif(trim(p.display_name), '')
  INTO profile_name
  FROM public.profiles AS p
  WHERE p.id = auth.uid();

  IF profile_name IS NOT NULL THEN
    NEW.author := left(regexp_replace(profile_name, '[<>]', '', 'g'), 80);
  ELSIF NEW.author IS NOT NULL THEN
    NEW.author := left(regexp_replace(trim(NEW.author), '[<>]', '', 'g'), 80);
  ELSE
    NEW.author := 'Kullanıcı';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_assign_auth_user_row ON public.comments;

CREATE TRIGGER comments_assign_auth_user_row
BEFORE INSERT ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.comments_assign_auth_user();

-- UPDATE: yalnızca kendi yorumu; kimlik alanları değiştirilemez
CREATE OR REPLACE FUNCTION public.comments_prevent_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR OLD.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'comments_update_forbidden';
  END IF;

  NEW.user_id := OLD.user_id;
  NEW.author := OLD.author;
  NEW.post_id := OLD.post_id;
  NEW.parent_comment_id := OLD.parent_comment_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_prevent_identity_change_row ON public.comments;

CREATE TRIGGER comments_prevent_identity_change_row
BEFORE UPDATE ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.comments_prevent_identity_change();

DROP POLICY IF EXISTS "comments_select_public" ON public.comments;
DROP POLICY IF EXISTS "comments_insert_authenticated" ON public.comments;
DROP POLICY IF EXISTS "comments_update_own" ON public.comments;
DROP POLICY IF EXISTS "comments_delete_own" ON public.comments;

CREATE POLICY "comments_select_public"
ON public.comments
FOR SELECT
TO authenticated, anon
USING (true);

CREATE POLICY "comments_insert_authenticated"
ON public.comments
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "comments_update_own"
ON public.comments
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "comments_delete_own"
ON public.comments
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

COMMENT ON FUNCTION public.comments_assign_auth_user () IS
  'Yorum eklerken user_id ve author alanlarını oturum açmış kullanıcıya sabitler.';
