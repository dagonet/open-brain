CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE thoughts (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  idempotency_key     TEXT UNIQUE,
  raw_text            TEXT NOT NULL CHECK (length(trim(raw_text)) > 0),
  embedding           vector(1536),
  embedding_model     TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  embedding_dimensions INT NOT NULL DEFAULT 1536,
  thought_type        TEXT CHECK (thought_type IN (
                        'decision', 'insight', 'meeting', 'action',
                        'reference', 'question', 'note'
                      )),
  people              TEXT[],
  topics              TEXT[],
  action_items        TEXT[],
  action_items_resolved BOOLEAN NOT NULL DEFAULT false,
  source              TEXT NOT NULL CHECK (source IN ('slack', 'cli', 'mcp')),
  processing_status   TEXT NOT NULL DEFAULT 'complete'
                        CHECK (processing_status IN ('complete', 'partial', 'failed')),
  metadata            JSONB DEFAULT '{}',
  deleted_at          TIMESTAMPTZ DEFAULT NULL,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON thoughts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON thoughts (created_at DESC);
CREATE INDEX ON thoughts USING gin (people);
CREATE INDEX ON thoughts USING gin (topics);
CREATE INDEX ON thoughts (deleted_at) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER thoughts_updated_at
  BEFORE UPDATE ON thoughts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE thoughts ENABLE ROW LEVEL SECURITY;