export type ThoughtSource = 'slack' | 'cli' | 'mcp' | 'import' | 'import-claude' | 'import-chatgpt';

export type ThoughtType =
  'decision' | 'insight' | 'meeting' | 'action' | 'reference' | 'question' | 'note';

export type ProcessingStatus = 'complete' | 'partial' | 'failed';

export interface ThoughtInput {
  text: string;
  source: ThoughtSource;
  idempotency_key?: string;
  project?: string;
  metadata?: Record<string, unknown>;
}

export interface ThoughtRecord {
  id: string;
  idempotency_key: string | null;
  raw_text: string;
  embedding: number[] | null;
  embedding_model: string;
  embedding_dimensions: number;
  thought_type: ThoughtType | null;
  people: string[];
  topics: string[];
  action_items: string[];
  action_items_resolved: boolean;
  source: ThoughtSource;
  processing_status: ProcessingStatus;
  metadata: Record<string, unknown>;
  project: string | null;
  salience: number | null;
  lifecycle_status?: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessingResult {
  thought: ThoughtRecord;
  is_duplicate: boolean;
  duplicate_candidate?: DuplicateCandidate;
}

export interface DuplicateCandidate {
  thought_id: string;
  raw_text_preview: string;
  similarity: number;
}

export interface MetadataExtraction {
  thought_type: string;
  people: string[];
  topics: string[];
  action_items: string[];
  salience?: number;
}

export interface EntityDescription {
  entity_name: string;
  entity_type: string;
  description: string;
}

export interface EntityExtractionResult {
  entities: EntityDescription[];
}
