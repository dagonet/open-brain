#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { allTools } from "./tools/index.js";
import type { Deps } from "./tools/registry.js";
import { buildInstructions } from "./instructions.js";
import { disabledFamilies, familyForToolName } from "./config.js";

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

const disabled = disabledFamilies(process.env.OPEN_BRAIN_TOOLS_DISABLED);
const wikiEnabled = !disabled.has("wiki");

const server = new McpServer(
  {
    name: "open-brain",
    version: "0.3.0",
  },
  {
    instructions: buildInstructions({ wikiEnabled }),
  },
);

const deps: Deps = { supabase, openai };

const enabledTools = allTools.filter((tool) => {
  const family = familyForToolName(tool.name);
  if (family === null) return true;
  return !disabled.has(family);
});

for (const tool of enabledTools) {
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
