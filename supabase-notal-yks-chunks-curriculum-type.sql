-- yks_chunks: müfredat (sınav programı / kazanım listesi) chunk türü
-- supabase-notal-yks-chunks.sql sonrasında çalıştırın.

ALTER TABLE public.yks_chunks
  DROP CONSTRAINT IF EXISTS yks_chunks_chunk_type_check;

ALTER TABLE public.yks_chunks
  ADD CONSTRAINT yks_chunks_chunk_type_check CHECK (
    chunk_type IN (
      'definition',
      'theorem',
      'explanation',
      'example',
      'question',
      'solution',
      'curriculum'
    )
  );

COMMENT ON COLUMN public.yks_chunks.chunk_type IS
  'curriculum = resmi sınav müfredatı / kazanım listesi kesiti (exam_prep pipeline).';
