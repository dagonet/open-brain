-- Allow reads for all non-deleted thoughts (single-user system, anon key)
CREATE POLICY "Allow read access to non-deleted thoughts"
  ON thoughts
  FOR SELECT
  USING (deleted_at IS NULL);
