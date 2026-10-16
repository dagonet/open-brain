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
// tests and OpenAI is an inert stub. fetch is stubbed to throw, so any accidental
// network access fails the test instead of reaching a live service.

const packageVersion = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

describe('MCP server smoke test (in-memory transport)', () => {
  let teardown: (() => Promise<void>) | undefined;

  /** Connects a client to a fresh server and registers the teardown for afterEach. */
  async function connect(toolsDisabledEnv?: string) {
    const mock = createMockSupabase();
    // Tools under test must not reach OpenAI; any use of this stub would throw.
    const openai = {} as unknown as OpenAI;
    const server = createServer({ supabase: mock.client, openai }, toolsDisabledEnv);
    const client = new Client({ name: 'smoke-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    teardown = async () => {
      await client.close();
      await server.close();
    };
    return { client, server, mock };
  }

  beforeEach(() => {
    // Keep results independent of the developer's shell environment and make sure
    // no live Supabase or OpenAI endpoint can be reached.
    vi.stubEnv('OPEN_BRAIN_TOOLS_DISABLED', '');
    vi.stubEnv('OPEN_BRAIN_DEFAULT_PROJECT', '');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('network access attempted in smoke test');
      }),
    );
  });

  afterEach(async () => {
    await teardown?.();
    teardown = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reports the package.json version as serverInfo.version', async () => {
    const { client } = await connect();

    expect(client.getServerVersion()).toMatchObject({
      name: 'open-brain',
      version: packageVersion,
    });
  });

  it('lists every registered tool', async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();

    expect(allTools.length).toBeGreaterThan(0);
    expect(tools).toHaveLength(allTools.length);
    expect(tools.map((t) => t.name).sort()).toEqual(allTools.map((t) => t.name).sort());
  });

  it('drops the wiki tools and instructions when the wiki family is disabled', async () => {
    const { client } = await connect('wiki');

    const { tools } = await client.listTools();

    const wikiTools = allTools.filter((t) => t.name.startsWith('wiki_'));
    expect(wikiTools.length).toBeGreaterThan(0);
    expect(tools).toHaveLength(allTools.length - wikiTools.length);
    expect(tools.some((t) => t.name.startsWith('wiki_'))).toBe(false);
    expect(client.getInstructions()).not.toContain('WIKI LAYER');
  });

  it('keeps the wiki instructions when no family is disabled', async () => {
    const { client } = await connect();

    expect(client.getInstructions()).toContain('WIKI LAYER');
  });

  it('calls thoughts_topics end to end against the stubbed Supabase client', async () => {
    const { client, mock } = await connect();
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
