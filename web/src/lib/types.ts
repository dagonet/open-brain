export interface Thought {
  id: string;
  raw_text: string;
  thought_type: string;
  people: string[];
  topics: string[];
  action_items: string[];
  action_items_resolved: boolean;
  source: string;
  processing_status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SearchParams {
  q?: string;
  type?: string;
  topic?: string;
  person?: string;
  page?: string;
  cursor?: string;
  cursor_id?: string;
}
