-- Kampanya e-posta tercihleri ve abonelikten cikis fonksiyonu
-- Supabase SQL Editor'da calistirin.

CREATE TABLE IF NOT EXISTS public.email_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  marketing_emails_enabled boolean NOT NULL DEFAULT true,
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_preferences_unsubscribe_token_uidx
ON public.email_preferences (unsubscribe_token);

ALTER TABLE public.email_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_preferences_select_own" ON public.email_preferences;
CREATE POLICY "email_preferences_select_own"
ON public.email_preferences
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "email_preferences_update_own" ON public.email_preferences;
CREATE POLICY "email_preferences_update_own"
ON public.email_preferences
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "email_preferences_insert_own" ON public.email_preferences;
CREATE POLICY "email_preferences_insert_own"
ON public.email_preferences
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

INSERT INTO public.email_preferences (user_id)
SELECT id
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user_email_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.email_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_email_preferences ON auth.users;
CREATE TRIGGER on_auth_user_created_email_preferences
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user_email_preferences();

CREATE OR REPLACE FUNCTION public.unsubscribe_marketing_by_token(p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_token IS NULL THEN
    RETURN false;
  END IF;

  SELECT user_id INTO v_user_id
  FROM public.email_preferences
  WHERE unsubscribe_token = p_token;

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.email_preferences
  SET
    marketing_emails_enabled = false,
    updated_at = now()
  WHERE user_id = v_user_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.unsubscribe_marketing_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsubscribe_marketing_by_token(uuid) TO anon, authenticated;
