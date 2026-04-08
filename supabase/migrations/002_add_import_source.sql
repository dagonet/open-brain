-- Migration: Add import source values to thoughts.source CHECK constraint
-- This allows importing memories from Claude, ChatGPT, or generic import sources.

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_attribute att ON att.attnum = ANY(con.conkey)
    AND att.attrelid = con.conrelid
  WHERE con.conrelid = 'thoughts'::regclass
    AND att.attname = 'source'
    AND con.contype = 'c';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE thoughts DROP CONSTRAINT ' || constraint_name;
  END IF;
END $$;

ALTER TABLE thoughts ADD CONSTRAINT thoughts_source_check
  CHECK (source IN ('slack', 'cli', 'mcp', 'import', 'import-claude', 'import-chatgpt'));
