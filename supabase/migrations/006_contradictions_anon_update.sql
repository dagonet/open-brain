-- Migration 006: Allow anon UPDATE on `contradictions`.
--
-- Discovered during the v0.3.0 smoke test: the `brain audit --resolve <id>`
-- CLI path uses the project's anon key (the only key in ~/.brain/config.json),
-- but migration 005 only granted UPDATE to `authenticated`. PostgREST silently
-- accepted the PATCH (returning 204 No Content with zero rows changed), so
-- the CLI printed "✓ Resolved" without anything actually happening.
--
-- Open Brain is a single-user system; the anon key is only known to the
-- project owner. Granting anon UPDATE on `contradictions` brings parity with
-- the existing anon SELECT policy and matches how the dashboard's server
-- actions are expected to behave under the same key.
--
-- Inspired by Andrej Karpathy's LLM Wiki gist
--   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
-- via Nate B Jones
--   https://www.youtube.com/watch?v=dxq7WtWxi44

CREATE POLICY "Allow anon update on contradictions"
  ON contradictions FOR UPDATE USING (true);
