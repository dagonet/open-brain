#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { allTools } from "./tools/index.js";
import type { Deps } from "./tools/registry.js";

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
  version: "0.2.0",
}, {
  instructions: [
    "Open Brain is the user's personal memory system — a second brain that persists across sessions.",
    "You MUST actively read from and write to it throughout every session.",
    "",
    "READING — Check memory early and often:",
    "- thoughts_search: At session start, search for context relevant to the current task or project.",
    "  When the user mentions a person, project, or topic, search to recall prior context.",
    "- thoughts_people: Check who has been mentioned before to maintain continuity across sessions.",
    "- thoughts_topics: Review known topics to connect current work to past decisions and insights.",
    "- thoughts_recent: Review recent thoughts to understand what the user has been working on.",
    "- thoughts_review: Use at session start or when planning to get a structured overview of recent activity.",
    "- system_status: Check system health if tools seem to be failing.",
    "",
    "WRITING — Capture durable knowledge:",
    "- thoughts_capture: Record decisions, insights, bug root causes, user preferences, action items,",
    "  and meeting notes. Write self-contained statements useful out of context.",
    "  Include project/feature names for searchability.",
    "  Do not ask permission — capture and mention it briefly.",
    "",
    "DO NOT CAPTURE: routine implementation details, temporary debugging state,",
    "information already in git commits, or anything the user marks as private.",
    "",
    "DELETING:",
    "- thoughts_delete: Remove outdated or incorrect memories when noticed.",
  ].join("\n"),
});

const deps: Deps = { supabase, openai };

for (const tool of allTools) {
  server.tool(tool.name, tool.description, tool.schema, async (params) => {
    const result = await tool.handler(deps, params as Record<string, unknown>);
    return { content: [{ type: "text" as const, text: result }] };
  });
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
