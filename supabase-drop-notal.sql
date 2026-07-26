-- NotAl kaldırıldı: tablolar ve RPC'ler.
-- Storage bucket temizliği Storage API ile yapılır (doğrudan DELETE engelli).

DROP TABLE IF EXISTS public.notal_note_feedback CASCADE;
DROP TABLE IF EXISTS public.notal_saved_notes CASCADE;
DROP TABLE IF EXISTS public.notal_user_credits CASCADE;
DROP TABLE IF EXISTS public.notal_pdf_ingests CASCADE;
DROP TABLE IF EXISTS public.notal_pre_requests CASCADE;
DROP TABLE IF EXISTS public.exam_prep_study_notes CASCADE;
DROP TABLE IF EXISTS public.exam_prep_study_sessions CASCADE;
DROP TABLE IF EXISTS public.yks_chunk_figures CASCADE;
DROP TABLE IF EXISTS public.yks_figures CASCADE;
DROP TABLE IF EXISTS public.yks_chunks CASCADE;
DROP TABLE IF EXISTS public.notes_images CASCADE;
DROP TABLE IF EXISTS public.academic_library_chunks CASCADE;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'match_yks_chunks',
        'match_yks_figures',
        'match_yks_figures_by_chunk',
        'match_notes_images',
        'match_academic_library',
        'set_notal_user_credits_updated_at'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;
