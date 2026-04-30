-- Migration 007: Entity descriptions table.
--
-- Stores rich descriptions for people and topics extracted from thoughts.
-- Separate table (does NOT ALTER thoughts). Descriptions are extracted in a
-- parallel LLM call during capture and stored here with a FK back to the
-- source thought.

CREATE TABLE entity_descriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thought_id    uuid NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
  entity_name   text NOT NULL,
  entity_type   text,
  description   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_entity_descriptions_thought
  ON entity_descriptions (thought_id);

CREATE INDEX idx_entity_descriptions_name
  ON entity_descriptions (entity_name);

-- Allow anon SELECT (matches existing RLS pattern for thoughts).
ALTER TABLE entity_descriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_entity_descriptions"
  ON entity_descriptions FOR SELECT
  TO anon
  USING (true);
