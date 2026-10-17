// Handler-level check that compile-wiki and detect-contradictions run the
// service-role guard before doing any work.
//
// Run (from the repo root; also run in CI, job "Edge Functions (Deno)"):
//   deno test --node-modules-dir=none --allow-env supabase/functions/handler-auth_test.ts
//
// Work is detected through globalThis.fetch: both handlers reach the database
// (supabase-js) and OpenAI only via fetch, so a recorded call means work started.
// All values below are made-up fixtures.

import { handler as compileWiki } from './compile-wiki/handler.ts';
import { handler as detectContradictions } from './detect-contradictions/handler.ts';

const FAKE_KEY = 'fake-service-key-for-tests';

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

const handlers: Array<[string, (req: Request) => Promise<Response>]> = [
  ['compile-wiki', compileWiki],
  ['detect-contradictions', detectContradictions],
];

function post(authorization?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authorization !== undefined) headers.Authorization = authorization;
  return new Request('http://localhost/fn', {
    method: 'POST',
    headers,
    body: JSON.stringify({ slug: 'example' }),
  });
}

// Runs fn with env + fetch stubbed; returns the number of fetch calls it made.
async function withStubs(fn: () => Promise<void>): Promise<number> {
  const realFetch = globalThis.fetch;
  const prevKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const prevUrl = Deno.env.get('SUPABASE_URL');
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    return Promise.reject(new Error('fetch must not be reached in these tests'));
  }) as typeof fetch;
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', FAKE_KEY);
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
    else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', prevKey);
    if (prevUrl === undefined) Deno.env.delete('SUPABASE_URL');
    else Deno.env.set('SUPABASE_URL', prevUrl);
  }
  return calls;
}

function assertEquals<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const rejected: Array<[string, string | undefined]> = [
  ['no Authorization header', undefined],
  ['non-Bearer scheme', 'Basic abc'],
  ['empty bearer', 'Bearer '],
  ['non-JWT bearer that is not the env key', 'Bearer not-a-jwt'],
  ['anon-role JWT', `Bearer ${jwt({ role: 'anon' })}`],
  ['authenticated-role JWT', `Bearer ${jwt({ role: 'authenticated' })}`],
];

for (const [name, handle] of handlers) {
  for (const [label, header] of rejected) {
    Deno.test(`${name}: 401 and no work for ${label}`, async () => {
      const calls = await withStubs(async () => {
        const req = post(header);
        const res = await handle(req);
        assertEquals(res.status, 401, 'status');
        const body = await res.json();
        assertEquals(body.error, 'Unauthorized', 'error');
        // The guard answers before the body is parsed.
        assertEquals(req.bodyUsed, false, 'request body consumed');
      });
      assertEquals(calls, 0, 'fetch calls');
    });
  }

  // The guard runs before the method check: an unauthenticated GET is 401, not 405.
  Deno.test(`${name}: 401 (not 405) for an unauthenticated GET`, async () => {
    const calls = await withStubs(async () => {
      const res = await handle(new Request('http://localhost/fn', { method: 'GET' }));
      assertEquals(res.status, 401, 'status');
    });
    assertEquals(calls, 0, 'fetch calls');
  });

  // Control cases: an authorized request gets past the guard. The 405 answer
  // proves the guard let it through while still doing no work.
  Deno.test(`${name}: service-role JWT passes the guard`, async () => {
    const calls = await withStubs(async () => {
      const req = new Request('http://localhost/fn', {
        method: 'GET',
        headers: { Authorization: `Bearer ${jwt({ role: 'service_role' })}` },
      });
      const res = await handle(req);
      assertEquals(res.status, 405, 'status');
    });
    assertEquals(calls, 0, 'fetch calls');
  });

  Deno.test(`${name}: bearer equal to the env service key passes the guard`, async () => {
    const calls = await withStubs(async () => {
      const req = new Request('http://localhost/fn', {
        method: 'GET',
        headers: { Authorization: `Bearer ${FAKE_KEY}` },
      });
      const res = await handle(req);
      assertEquals(res.status, 405, 'status');
    });
    assertEquals(calls, 0, 'fetch calls');
  });
}

// ---- detect-contradictions request body (#102) -------------------------------
// A present-but-invalid JSON body is a client error (400, no work), as in
// compile-wiki. An absent or empty body still runs the default audit.

const serviceAuth = { Authorization: `Bearer ${jwt({ role: 'service_role' })}` };

Deno.test('detect-contradictions: 400 and no work for an invalid JSON body', async () => {
  const calls = await withStubs(async () => {
    const res = await detectContradictions(
      new Request('http://localhost/fn', {
        method: 'POST',
        headers: { ...serviceAuth, 'Content-Type': 'application/json' },
        body: '{not valid json',
      }),
    );
    assertEquals(res.status, 400, 'status');
    const body = await res.json();
    assertEquals(body.success, false, 'success');
    assertEquals(body.error, 'Invalid JSON body', 'error');
  });
  assertEquals(calls, 0, 'fetch calls');
});

Deno.test('detect-contradictions: 400 and no work for a non-object JSON body', async () => {
  for (const raw of ['null', '42', '[]']) {
    const calls = await withStubs(async () => {
      const res = await detectContradictions(
        new Request('http://localhost/fn', {
          method: 'POST',
          headers: { ...serviceAuth, 'Content-Type': 'application/json' },
          body: raw,
        }),
      );
      assertEquals(res.status, 400, `status for ${raw}`);
      const body = await res.json();
      assertEquals(body.success, false, `success for ${raw}`);
      assertEquals(body.error, 'Request body must be a JSON object', `error for ${raw}`);
    });
    assertEquals(calls, 0, `fetch calls for ${raw}`);
  }
});

for (const [label, init] of [
  ['no body', {}],
  ['empty string body', { body: '' }],
  ['whitespace-only body', { body: '  \n' }],
] as Array<[string, RequestInit]>) {
  Deno.test(`detect-contradictions: ${label} still runs the default audit`, async () => {
    let status = 0;
    const calls = await withStubs(async () => {
      const res = await detectContradictions(
        new Request('http://localhost/fn', { method: 'POST', headers: serviceAuth, ...init }),
      );
      status = res.status;
    });
    // The audit started (it reached the stubbed database fetch) and did not answer 400.
    if (calls === 0) throw new Error('expected the default audit to start, but no fetch was made');
    if (status === 400) throw new Error('expected no 400 for an empty body');
  });
}
