import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type OpenAI from 'openai';
import { createServer } from '../server.js';
import { allTools } from '../tools/index.js';
import { createMockSupabase } from '../tools/__tests__/helpers.js';

// Smoke test: the real server, wired with its real tool registry, driven by a real
// MCP client over an in-memory transport. Supabase is the chainable mock from the tool
// tests and OpenAI is an inert stub, so nothing here touches the network or needs keys.

const EXPECTED_TOOL_COUNT = 22;

const packageVersion = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

async function connect(toolsDisabledEnv?: string) {
  const mock = createMockSupabase();
  // Tools under test must not reach OpenAI; any use of this stub would throw.
  const openai = {} as unknown as OpenAI;
  const server = createServer({ supabase: mock.client, openai }, toolsDisabledEnv);
  const client = new Client({ name: 'smoke-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, mock };
}

describe('MCP server smoke test (in-memory transport)', () => {
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    // Keep the tool count independent of the developer's shell environment.
    vi.stubEnv('OPEN_BRAIN_TOOLS_DISABLED', '');
    vi.stubEnv('OPEN_BRAIN_DEFAULT_PROJECT', '');
  });

  afterEach(async () => {
    await close?.();
    close = undefined;
    vi.unstubAllEnvs();
  });

  it('reports the package.json version as serverInfo.version', async () => {
    const { client, server } = await connect();
    close = async () => {
      await client.close();
      await server.close();
    };

    expect(client.getServerVersion()).toMatchObject({
      name: 'open-brain',
      version: packageVersion,
    });
  });

  it('lists every registered tool', async () => {
    const { client, server } = await connect();
    close = async () => {
      await client.close();
      await server.close();
    };

    const { tools } = await client.listTools();

    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
    expect(allTools).toHaveLength(EXPECTED_TOOL_COUNT);
    expect(tools.map((t) => t.name).sort()).toEqual(allTools.map((t) => t.name).sort());
  });

  it('honours OPEN_BRAIN_TOOLS_DISABLED when listing tools', async () => {
    const { client, server } = await connect('wiki');
    close = async () => {
      await client.close();
      await server.close();
    };

    const { tools } = await client.listTools();

    expect(tools.some((t) => t.name.startsWith('wiki_'))).toBe(false);
    expect(tools.length).toBeLessThan(EXPECTED_TOOL_COUNT);
  });

  it('calls thoughts_topics end to end against the stubbed Supabase client', async () => {
    const { client, server, mock } = await connect();
    close = async () => {
      await client.close();
      await server.close();
    };
    mock.resolvesWith([
      { topics: ['a', 'b'], created_at: '2026-01-01T00:00:00Z' },
      { topics: ['a'], created_at: '2026-02-01T00:00:00Z' },
    ]);

    const result = await client.callTool({ name: 'thoughts_topics', arguments: {} });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe('text');
    expect(JSON.parse(content[0].text)).toEqual([
      { topic: 'a', count: 2, last_mentioned_at: '2026-02-01T00:00:00Z' },
      { topic: 'b', count: 1, last_mentioned_at: '2026-01-01T00:00:00Z' },
    ]);
  });
});
