// Handler-level check that compile-wiki and detect-contradictions run the
// service-role guard before doing any work.
//
// Run (from the repo root; also run in CI, job "Edge Functions (Deno)"):
//   deno test --node-modules-dir=none --allow-env supabase/functions/handler-auth_test.ts
//
// Work is detected through globalThis.fetch: both handlers reach the database
// (supabase-js) and OpenAI only via fetch, so a recorded call means work started.
// Most tests expect zero calls; the body tests that expect an audit to start
// expect at least one (the stub answers with an empty list, so nothing real runs).
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
// The stub answers every request with an empty 200 list (so a handler that does
// start work finishes cleanly without logging a failure) and, when given, pushes
// each requested URL onto `urls`.
async function withStubs(fn: () => Promise<void>, urls?: string[]): Promise<number> {
  const realFetch = globalThis.fetch;
  const prevKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const prevUrl = Deno.env.get('SUPABASE_URL');
  let calls = 0;
  globalThis.fetch = ((input: Request | URL | string) => {
    calls++;
    urls?.push(input instanceof Request ? input.url : String(input));
    return Promise.resolve(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
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
  for (const raw of ['null', '42', '[]', '"text"', 'true']) {
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

// ---- compile-wiki request body (#105) ----------------------------------------

Deno.test('compile-wiki: 400 and no work for a non-object JSON body', async () => {
  for (const raw of ['null', '42', '"text"', 'true', '[]']) {
    const calls = await withStubs(async () => {
      const res = await compileWiki(
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

Deno.test('compile-wiki: a JSON object body with a slug passes body validation', async () => {
  let status = 0;
  const calls = await withStubs(async () => {
    const res = await compileWiki(
      new Request('http://localhost/fn', {
        method: 'POST',
        headers: { ...serviceAuth, 'Content-Type': 'application/json' },
        body: '{"slug":"example"}',
      }),
    );
    status = res.status;
  });
  if (calls === 0) throw new Error('expected compile to start, but no fetch was made');
  if (status === 400) throw new Error('expected a valid body not to answer 400');
});

// The authorized PUT is rejected by the method check before the body is read.
Deno.test(
  'detect-contradictions: 405 and no work for a PUT with an invalid JSON body',
  async () => {
    const calls = await withStubs(async () => {
      const res = await detectContradictions(
        new Request('http://localhost/fn', {
          method: 'PUT',
          headers: serviceAuth,
          body: '{not valid json',
        }),
      );
      assertEquals(res.status, 405, 'status');
    });
    assertEquals(calls, 0, 'fetch calls');
  },
);

// [label, request init, whether the candidate query carries the `since` filter]
for (const [label, init, hasSince] of [
  ['no body', {}, false],
  ['empty string body', { body: '' }, false],
  ['whitespace-only body', { body: '  \n' }, false],
  ['empty object body', { body: '{}' }, false],
  ['object body with since', { body: '{"since":"2026-01-01T00:00:00Z"}' }, true],
] as Array<[string, RequestInit, boolean]>) {
  Deno.test(`detect-contradictions: ${label} runs the audit`, async () => {
    let status = 0;
    const urls: string[] = [];
    const calls = await withStubs(async () => {
      const res = await detectContradictions(
        new Request('http://localhost/fn', { method: 'POST', headers: serviceAuth, ...init }),
      );
      status = res.status;
    }, urls);
    // The audit started (it reached the stubbed database fetch) and did not answer 400.
    if (calls === 0) throw new Error('expected the audit to start, but no fetch was made');
    assertEquals(status, 200, 'status');
    // The decoded body reached the candidate query: `since` becomes a created_at filter.
    assertEquals(
      urls.some((u) => u.includes('created_at=gte.')),
      hasSince,
      'candidate query has a created_at=gte filter',
    );
  });
}
