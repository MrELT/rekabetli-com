-- Topluluk akışı: gönderi sahibi, beğeni ve kaydetme
-- Supabase SQL Editor'da çalıştırın.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

CREATE TABLE IF NOT EXISTS post_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_saves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_saves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_likes_select" ON post_likes;
DROP POLICY IF EXISTS "post_likes_insert" ON post_likes;
DROP POLICY IF EXISTS "post_likes_delete" ON post_likes;
DROP POLICY IF EXISTS "post_saves_select" ON post_saves;
DROP POLICY IF EXISTS "post_saves_insert" ON post_saves;
DROP POLICY IF EXISTS "post_saves_delete" ON post_saves;
DROP POLICY IF EXISTS "posts_delete_own" ON posts;

CREATE POLICY "post_likes_select" ON post_likes FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "post_likes_insert" ON post_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "post_likes_delete" ON post_likes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "post_saves_select" ON post_saves FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "post_saves_insert" ON post_saves FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "post_saves_delete" ON post_saves FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "posts_delete_own" ON posts FOR DELETE TO authenticated USING (auth.uid() = user_id);
