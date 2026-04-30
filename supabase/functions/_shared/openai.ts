import { EntityExtractionResult, MetadataExtraction } from "./types.ts";

const OPENAI_API_URL = "https://api.openai.com/v1";

function getApiKey(): string {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  return key;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${OPENAI_API_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding request failed (${response.status}): ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

const METADATA_SYSTEM_PROMPT = `You are a metadata extraction assistant. Analyze the given text and extract structured metadata.

Classify the thought into exactly one of these types:
- decision: choices made, directions taken (e.g. "We decided to use PostgreSQL")
- insight: realizations, learnings, observations (e.g. "I noticed our cache hit rate drops on Mondays")
- meeting: meeting notes, discussion summaries (e.g. "Standup notes: discussed sprint goals")
- action: tasks to do, assignments (e.g. "Need to update the API docs by Friday")
- reference: links, resources, documentation (e.g. "Useful article on database indexing: ...")
- question: open questions, things to investigate (e.g. "Why is latency spiking after 3pm?")
- note: general notes that don't fit other categories (default)

Extract people mentioned. Use full names consistently (e.g. "Sarah Johnson" not "Sarah").
Extract topics as lowercase keywords.
Extract action items as clear task descriptions.

Return JSON with this exact structure:
{
  "thought_type": "one of the types above",
  "people": ["Full Name"],
  "topics": ["topic"],
  "action_items": ["action item description"]
}

If no people, topics, or action items are found, return empty arrays.`;

export async function extractMetadata(text: string): Promise<MetadataExtraction> {
  const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: METADATA_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI chat request failed (${response.status}): ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  return JSON.parse(content) as MetadataExtraction;
}

const ENTITY_DESCRIPTIONS_SYSTEM_PROMPT = `You are an entity description assistant. Given a thought, identify the key entities (people, projects, technologies, organizations, concepts) mentioned and write a brief description for each.

For each entity, return:
- entity_name: the canonical name
- entity_type: one of "person", "project", "technology", "organization", "concept", "event", "resource"
- description: one sentence explaining what this entity is in the context of the thought

Focus on entities that are central to the thought's meaning. Skip generic terms. Base descriptions on what the thought text reveals.

Return JSON with this exact structure:
{
  "entities": [
    {"entity_name": "name", "entity_type": "type", "description": "description"}
  ]
}

If no meaningful entities are found, return an empty entities array.`;

export async function extractEntityDescriptions(
  text: string,
): Promise<EntityExtractionResult> {

  const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: ENTITY_DESCRIPTIONS_SYSTEM_PROMPT },
        {
          role: "user",
          content: text,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Entity extraction request failed (${response.status}): ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  return JSON.parse(content) as EntityExtractionResult;
}

// ---------------------------------------------------------------------------
// Structured Outputs helper for the wiki / contradictions pipeline.
//
// Inspired by Andrej Karpathy's LLM Wiki gist
//   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
// via Nate B Jones
//   https://www.youtube.com/watch?v=dxq7WtWxi44
//
// Citation UUIDs are passed as `string` with a regex pattern; OpenAI's JSON
// Schema subset for Structured Outputs does NOT accept `format: "uuid"`.
// ---------------------------------------------------------------------------

export interface StructuredMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StructuredOptions {
  model?: string;
  temperature?: number;
  schema_name: string;
  schema: Record<string, unknown>;
}

export async function chatCompletionsStructured<T>(
  messages: StructuredMessage[],
  options: StructuredOptions,
): Promise<T> {
  const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? "gpt-4o-mini",
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: options.schema_name,
          schema: options.schema,
          strict: true,
        },
      },
      temperature: options.temperature ?? 0,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `OpenAI structured chat request failed (${response.status}): ${error}`,
    );
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  return JSON.parse(content) as T;
}

export const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
