-- Mentör vitrin öğeleri için isteğe bağlı accent (renk) alanı
-- branches / private_lessons / packages JSON öğeleri:
-- { id, title, description|content, price?, accent?: "blue"|"violet"|... }

COMMENT ON COLUMN public.mentor_pages.branches IS
  'Mentörlük branşları: [{ id, title, description, accent? }]';

COMMENT ON COLUMN public.mentor_pages.private_lessons IS
  'Özel dersler: [{ id, title, description, accent? }]';

COMMENT ON COLUMN public.mentor_pages.packages IS
  'Paketler: [{ id, title, content, price, accent? }]';
