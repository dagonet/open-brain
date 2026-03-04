import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ThoughtInput,
  ThoughtRecord,
  ProcessingResult,
  ThoughtType,
} from "./types.ts";
import { generateEmbedding, extractMetadata } from "./openai.ts";
const ALLOWED_THOUGHT_TYPES: ThoughtType[] = [
  "decision", "insight", "meeting", "action", "reference", "question", "note",
];
const MAX_TEXT_LENGTH = 4000;
function getSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient(url, key);
}
export async function processThought(
  input: ThoughtInput,
): Promise<ProcessingResult> {
  // 1. Validate input
  const trimmedText = input.text?.trim();
  if (!trimmedText) {
    throw new Error("Text is required and cannot be empty");
  }
  if (trimmedText.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
  }
  const supabase = getSupabaseClient();
  // 2. Check idempotency
  if (input.idempotency_key) {
    const { data: existing } = await supabase
      .from("thoughts")
      .select("*")
      .eq("idempotency_key", input.idempotency_key)
      .maybeSingle();
    if (existing) {
      return { thought: existing as ThoughtRecord, is_duplicate: true };
    }
  }
  // 3. Call embedding and metadata extraction in parallel
  let embedding: number[] | null = null;
  let thoughtType: ThoughtType = "note";
  let people: string[] = [];
  let topics: string[] = [];
  let actionItems: string[] = [];
  let processingStatus: "complete" | "partial" | "failed" = "complete";
  const [embeddingResult, metadataResult] = await Promise.allSettled([
    generateEmbedding(trimmedText),
    extractMetadata(trimmedText),
  ]);
  if (embeddingResult.status === "fulfilled") {
    embedding = embeddingResult.value;
  } else {
    console.error("Embedding generation failed:", embeddingResult.reason);
  }
  if (metadataResult.status === "fulfilled") {
    const meta = metadataResult.value;
    // 4. Post-process metadata
    thoughtType = ALLOWED_THOUGHT_TYPES.includes(meta.thought_type as ThoughtType)
      ? (meta.thought_type as ThoughtType)
      : "note";
    people = (meta.people ?? []).map((p: string) => p.trim());
    topics = (meta.topics ?? []).map((t: string) => t.toLowerCase().trim());
    actionItems = meta.action_items ?? [];
  } else {
    console.error("Metadata extraction failed:", metadataResult.reason);
  }
  // 5. Determine processing status based on graceful degradation
  if (embeddingResult.status === "rejected" && metadataResult.status === "rejected") {
    processingStatus = "failed";
  } else if (embeddingResult.status === "rejected") {
    processingStatus = "failed";
  } else if (metadataResult.status === "rejected") {
    processingStatus = "partial";
  }
  // 6. Insert into thoughts table
  const record: Record<string, unknown> = {
    raw_text: trimmedText,
    embedding: embedding ? ("[" + embedding.join(",") + "]") : null,
    embedding_model: "text-embedding-3-small",
    embedding_dimensions: 1536,
    thought_type: thoughtType,
    people,
    topics,
    action_items: actionItems,
    source: input.source,
    processing_status: processingStatus,
    metadata: input.metadata ?? {},
  };
  if (input.idempotency_key) {
    record.idempotency_key = input.idempotency_key;
  }
  const { data, error } = await supabase
    .from("thoughts")
    .insert(record)
    .select("*")
    .single();
  if (error) {
    throw new Error("Failed to insert thought: " + error.message);
  }
  return { thought: data as ThoughtRecord, is_duplicate: false };
}
