#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { z } from "zod";
import { semanticSearch } from "./tools/semantic-search.js";
import { listRecent } from "./tools/list-recent.js";
import { deleteThought } from "./tools/delete-thought.js";
import { systemStatus } from "./tools/system-status.js";
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!openaiKey) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: openaiKey });
const server = new McpServer({
  name: "open-brain",
  version: "0.1.0",
});
server.tool(
  "semantic_search",
  "Search thoughts by semantic similarity. Embeds the query and finds the most relevant thoughts.",
  {
    query: z.string().describe("The search query to embed and match against thoughts"),
    limit: z.number().optional().default(10).describe("Max results to return"),
    thought_type: z
      .enum(["decision", "insight", "meeting", "action", "reference", "question", "note"])
      .optional()
      .describe("Filter by thought type"),
    people: z.array(z.string()).optional().describe("Filter by people mentioned"),
    topics: z.array(z.string()).optional().describe("Filter by topics"),
    days: z.number().optional().describe("Only search thoughts from the last N days"),
  },
  async (params) => {
    const result = await semanticSearch(supabase, openai, params);
    return { content: [{ type: "text" as const, text: result }] };
  }
);
server.tool(
  "list_recent",
  "List recent thoughts ordered by creation date. No embedding needed -- useful as a fallback when semantic search is unavailable.",
  {
    days: z.number().optional().default(7).describe("Number of days to look back"),
    limit: z.number().optional().default(20).describe("Max results to return"),
  },
  async (params) => {
    const result = await listRecent(supabase, params);
    return { content: [{ type: "text" as const, text: result }] };
  }
);
server.tool(
  "delete_thought",
  "Soft-delete a thought by ID. Sets deleted_at timestamp; does not permanently remove data.",
  {
    id: z.string().uuid().describe("UUID of the thought to delete"),
  },
  async (params) => {
    const result = await deleteThought(supabase, params);
    return { content: [{ type: "text" as const, text: result }] };
  }
);
server.tool(
  "system_status",
  "Get system status: total thoughts, counts by status and source, recent failures, and embedding config.",
  {},
  async () => {
    const result = await systemStatus(supabase);
    return { content: [{ type: "text" as const, text: result }] };
  }
);
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
