-- Mentör ödeme hesabı (IBAN) — hassas veri, yalnızca mentör ve admin okuyabilir.
-- supabase-mentor-pages.sql sonrasında bir kez çalıştırın.

ALTER TABLE public.mentor_pages
ADD COLUMN IF NOT EXISTS payout_ready boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.mentor_pages.payout_ready IS
  'Ödeme hesabı kayıtlı mı (IBAN detayı ayrı tabloda; vitrin için bayrak).';

CREATE TABLE IF NOT EXISTS public.mentor_payout_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  account_holder text NOT NULL,
  bank_name text NOT NULL,
  iban text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mentor_payout_account_holder_len CHECK (
    char_length(trim(account_holder)) BETWEEN 3 AND 120
  ),
  CONSTRAINT mentor_payout_bank_name_len CHECK (
    char_length(trim(bank_name)) BETWEEN 2 AND 80
  ),
  CONSTRAINT mentor_payout_iban_len CHECK (char_length(iban) = 26),
  CONSTRAINT mentor_payout_iban_format CHECK (iban ~ '^TR[0-9]{24}$')
);

COMMENT ON TABLE public.mentor_payout_accounts IS
  'Mentör banka hesabı — yalnızca hesap sahibi ve admin erişebilir.';

CREATE INDEX IF NOT EXISTS mentor_payout_accounts_updated_idx
ON public.mentor_payout_accounts (updated_at DESC);

ALTER TABLE public.mentor_payout_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_payout_select_own" ON public.mentor_payout_accounts;
CREATE POLICY "mentor_payout_select_own"
ON public.mentor_payout_accounts
FOR SELECT
TO authenticated
USING (auth.uid () = user_id);

DROP POLICY IF EXISTS "mentor_payout_select_admin" ON public.mentor_payout_accounts;
CREATE POLICY "mentor_payout_select_admin"
ON public.mentor_payout_accounts
FOR SELECT
TO authenticated
USING (public.is_admin_user (auth.uid ()));

DROP POLICY IF EXISTS "mentor_payout_insert_own_mentor" ON public.mentor_payout_accounts;
CREATE POLICY "mentor_payout_insert_own_mentor"
ON public.mentor_payout_accounts
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid () = user_id
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid ()
      AND p.is_mentor = true
  )
);

DROP POLICY IF EXISTS "mentor_payout_update_own_mentor" ON public.mentor_payout_accounts;
CREATE POLICY "mentor_payout_update_own_mentor"
ON public.mentor_payout_accounts
FOR UPDATE
TO authenticated
USING (
  auth.uid () = user_id
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid ()
      AND p.is_mentor = true
  )
)
WITH CHECK (
  auth.uid () = user_id
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid ()
      AND p.is_mentor = true
  )
);

CREATE OR REPLACE FUNCTION public.sync_mentor_payout_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.mentor_pages
    SET payout_ready = false,
        updated_at = now()
    WHERE user_id = OLD.user_id;
    RETURN OLD;
  END IF;

  UPDATE public.mentor_pages
  SET payout_ready = true,
      updated_at = now()
  WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mentor_payout_accounts_sync_ready ON public.mentor_payout_accounts;
CREATE TRIGGER mentor_payout_accounts_sync_ready
AFTER INSERT OR UPDATE OR DELETE ON public.mentor_payout_accounts
FOR EACH ROW
EXECUTE FUNCTION public.sync_mentor_payout_ready();
