import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { allTools } from './tools/index.js';
import type { Deps } from './tools/registry.js';
import { buildInstructions } from './instructions.js';
import { disabledFamilies, familyForToolName } from './config.js';

// package.json is the single source of the reported server version. The relative
// path resolves from both src/ (tests, tsx) and dist/ (compiled build).
const require = createRequire(import.meta.url);
export const SERVER_VERSION: string = (require('../package.json') as { version: string }).version;

/**
 * Builds the MCP server with all enabled tools registered. It reads no environment
 * variables, creates no clients and connects no transport, so tests can drive it
 * over an in-memory transport with stubbed dependencies. (The only I/O is the
 * one-time read of package.json for the version when this module is loaded.)
 *
 * @param deps Supabase and OpenAI clients handed to every tool handler.
 * @param toolsDisabledEnv Value of OPEN_BRAIN_TOOLS_DISABLED (comma-separated families),
 *   or undefined to enable every family.
 */
export function createServer(deps: Deps, toolsDisabledEnv: string | undefined): McpServer {
  const disabled = disabledFamilies(toolsDisabledEnv);

  const server = new McpServer(
    {
      name: 'open-brain',
      version: SERVER_VERSION,
    },
    {
      instructions: buildInstructions({
        wikiEnabled: !disabled.has('wiki'),
        entitiesEnabled: !disabled.has('entities'),
      }),
    },
  );

  const enabledTools = allTools.filter((tool) => {
    const family = familyForToolName(tool.name);
    if (family === null) return true;
    return !disabled.has(family);
  });

  for (const tool of enabledTools) {
    server.tool(tool.name, tool.description, tool.schema, async (params) => {
      const result = await tool.handler(deps, params as Record<string, unknown>);
      return { content: [{ type: 'text' as const, text: result }] };
    });
  }

  return server;
}
