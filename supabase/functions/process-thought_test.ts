// Tests for the shared processThought() near-duplicate hint.
//
// Run (from the repo root; also run in CI, job "Edge Functions (Deno)"):
//   deno test --node-modules-dir=none --allow-env supabase/functions/process-thought_test.ts
//
// OpenAI and PostgREST are reached only through globalThis.fetch, which is stubbed.
// All values below are made-up fixtures.

import { processThought } from './_shared/process-thought.ts';

const ENV = {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key-for-tests',
  OPENAI_API_KEY: 'fake-openai-key-for-tests',
} as const;

function assertEquals<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// nearDups: what the find_near_dups RPC returns.
async function run(nearDups: unknown[]) {
  const realFetch = globalThis.fetch;
  const prev = Object.keys(ENV).map((k) => [k, Deno.env.get(k)] as const);
  for (const [k, v] of Object.entries(ENV)) Deno.env.set(k, v);
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    if (url.hostname === 'api.openai.com') {
      // Only the embedding succeeds; metadata and entity extraction fail (best-effort).
      return Promise.resolve(
        url.pathname.endsWith('/embeddings')
          ? json({ data: [{ embedding: [0.1, 0.2, 0.3] }] })
          : json({ error: 'unavailable' }, 500),
      );
    }
    if (url.pathname === '/rest/v1/thoughts' && (req?.method ?? init?.method) === 'POST') {
      return Promise.resolve(json({ id: 'new-id', raw_text: 'a thought' }));
    }
    if (url.pathname === '/rest/v1/rpc/find_near_dups') {
      return Promise.resolve(json(nearDups));
    }
    return Promise.reject(new Error(`unexpected fetch ${url.href}`));
  }) as typeof fetch;
  try {
    return await processThought({ text: 'a thought', source: 'cli' });
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of prev) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test(
  'processThought: carries duplicate_candidate (snake_case) when a near-duplicate exists',
  async () => {
    const result = await run([
      { id: 'old-id', raw_text: 'a very similar thought', similarity: 0.95 },
    ]);
    const dc = result.duplicate_candidate;
    if (!dc) throw new Error('duplicate_candidate missing from the result');
    assertEquals(dc.thought_id, 'old-id', 'thought_id');
    assertEquals(dc.raw_text_preview, 'a very similar thought', 'raw_text_preview');
    assertEquals(dc.similarity, 0.95, 'similarity');
    assertEquals('duplicateCandidate' in result, false, 'camelCase key must not be used');
  },
);

Deno.test(
  'processThought: duplicate_candidate is absent when there is no near-duplicate',
  async () => {
    const result = await run([]);
    assertEquals(result.duplicate_candidate, undefined, 'duplicate_candidate');
    assertEquals(
      JSON.stringify(result).includes('duplicate_candidate'),
      false,
      'serialised result',
    );
  },
);
