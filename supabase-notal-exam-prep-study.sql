-- Exam prep çalışma oturumu + not cache
-- supabase-notal-yks-chunks.sql sonrasında çalıştırın.

CREATE TABLE IF NOT EXISTS public.exam_prep_study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  exam_goal text NOT NULL DEFAULT '',
  curriculum text,
  subject text,
  queue_source text NOT NULL DEFAULT 'material',
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  alignment_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exam_prep_study_sessions_owner_idx
  ON public.exam_prep_study_sessions (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.exam_prep_study_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.exam_prep_study_sessions (id) ON DELETE CASCADE,
  topic_index integer NOT NULL,
  topic_title text NOT NULL DEFAULT '',
  markdown text NOT NULL,
  revised boolean NOT NULL DEFAULT false,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_prep_study_notes_session_topic_unique UNIQUE (session_id, topic_index)
);

CREATE INDEX IF NOT EXISTS exam_prep_study_notes_session_idx
  ON public.exam_prep_study_notes (session_id, topic_index);

ALTER TABLE public.exam_prep_study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_prep_study_notes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.exam_prep_study_sessions IS
  'NotAl sınav hazırlık: konu konu çalışma oturumu kuyruğu.';
COMMENT ON TABLE public.exam_prep_study_notes IS
  'NotAl sınav hazırlık: oturum başına üretilmiş konu notları (cache).';
