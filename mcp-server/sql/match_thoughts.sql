CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding vector(1536),
  match_count int DEFAULT 10,
  filter_thought_type text DEFAULT NULL,
  filter_people text[] DEFAULT NULL,
  filter_topics text[] DEFAULT NULL,
  filter_days int DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  raw_text text,
  thought_type text,
  people text[],
  topics text[],
  action_items text[],
  action_items_resolved boolean,
  source text,
  processing_status text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.raw_text, t.thought_type, t.people, t.topics,
    t.action_items, t.action_items_resolved, t.source,
    t.processing_status, t.metadata, t.created_at, t.updated_at,
    1 - (t.embedding <=> query_embedding) AS similarity
  FROM thoughts t
  WHERE t.deleted_at IS NULL
    AND t.embedding IS NOT NULL
    AND (filter_thought_type IS NULL OR t.thought_type = filter_thought_type)
    AND (filter_people IS NULL OR t.people && filter_people)
    AND (filter_topics IS NULL OR t.topics && filter_topics)
    AND (filter_days IS NULL OR t.created_at > now() - make_interval(days => filter_days))
  ORDER BY t.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;