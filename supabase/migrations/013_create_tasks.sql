-- Migration 013: Tasks table for v0.6 task-state API (WS4)
--
-- STRICTLY ADDITIVE. Creates the tasks table with status lifecycle tracking
-- and RLS policies matching the existing thought-table pattern.
--
-- update_updated_at() trigger function is reused from migration 001 -- it is
-- NOT redefined here.
--
-- Inspired by Andrej Karpathy's LLM Wiki gist
--   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
-- via Nate B Jones
--   https://www.youtube.com/watch?v=dxq7WtWxi44

-- ---------------------------------------------------------------------------
-- 1. Tasks table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project text,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','blocked','done','cancelled')),
  priority smallint CHECK (priority >= 1 AND priority <= 5),
  linked_thought_ids uuid[] DEFAULT '{}',
  metadata jsonb DEFAULT '{}'::jsonb,
  status_history jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status
  ON tasks (project, status)
  WHERE deleted_at IS NULL;

CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_select_anon ON tasks
  FOR SELECT TO anon
  USING (deleted_at IS NULL);

CREATE POLICY tasks_all_service_role ON tasks
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------

GRANT SELECT ON tasks TO anon;
GRANT INSERT, UPDATE, DELETE ON tasks TO service_role;

-- ---------------------------------------------------------------------------
-- Rollback
--
-- DROP TABLE IF EXISTS tasks;
-- (Cascades: drops policies, trigger, and index with the table.)
-- ---------------------------------------------------------------------------
