// Handler-level tests for the tasks-feed edge function.
//
// Run (from the repo root; also run in CI, job "Edge Functions (Deno)"):
//   deno test --node-modules-dir=none --allow-env supabase/functions/tasks-feed_test.ts
//
// The database is reached only through globalThis.fetch (supabase-js -> PostgREST),
// so a recorded fetch call means the handler started work. Auth failures, the
// method check and a missing secret must all answer with zero fetch calls.
// All values below are made-up fixtures.

import { digestsEqual, handler } from './tasks-feed/handler.ts';

const FEED_TOKEN = 'feed-token-for-tests-0123456789abcdef';
// Wrong tokens whose SHA-256 matches the digest of FEED_TOKEN at exactly one byte
// position (byte 0 and byte 31). A comparison that looks at only the first byte, or
// only the last one, accepts them; the fixture test below checks the property.
const FIRST_BYTE_ONLY_TOKEN = 'wrong-token-65';
const LAST_BYTE_ONLY_TOKEN = 'wrong-token-201';
const FAKE_SERVICE_KEY = 'fake-service-key-for-tests';
const FAKE_URL = 'http://localhost:54321';
const SELECT = 'id,project,title,status,priority,metadata,updated_at';

interface FetchCall {
  url: URL;
  method: string;
  headers: Headers;
}

interface Stubs {
  // undefined: leave the secret unset. Anything else is set as given (including '').
  token?: string;
  supabaseUrl?: string;
  // Answers the stubbed fetch. The default fails the test run when fetch is reached.
  respond?: (call: FetchCall) => Response | Promise<Response>;
}

const ENV_NAMES = ['TASKS_FEED_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'] as const;

// Runs fn with env + fetch stubbed; returns the fetch calls it made.
async function withStubs(stubs: Stubs, fn: () => Promise<void>): Promise<FetchCall[]> {
  const realFetch = globalThis.fetch;
  const prev = ENV_NAMES.map((name) => [name, Deno.env.get(name)] as const);
  const calls: FetchCall[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const call: FetchCall = {
      url: new URL(req ? req.url : String(input)),
      method: req ? req.method : (init?.method ?? 'GET'),
      headers: new Headers(req ? req.headers : init?.headers),
    };
    calls.push(call);
    if (!stubs.respond) {
      return Promise.reject(new Error('fetch must not be reached in this test'));
    }
    return Promise.resolve(stubs.respond(call));
  }) as typeof fetch;
  for (const name of ENV_NAMES) Deno.env.delete(name);
  if (stubs.token !== undefined) Deno.env.set('TASKS_FEED_TOKEN', stubs.token);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', FAKE_SERVICE_KEY);
  Deno.env.set('SUPABASE_URL', stubs.supabaseUrl ?? FAKE_URL);
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const [name, value] of prev) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
  return calls;
}

function request(method: string, authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.Authorization = authorization;
  return new Request('http://localhost/functions/v1/tasks-feed', { method, headers });
}

function assertEquals<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertNoLeak(text: string, secret: string, msg: string) {
  if (text.includes(secret)) throw new Error(`${msg}: response leaks ${secret}`);
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

// Byte positions at which two equally long arrays hold the same value.
function equalPositions(a: Uint8Array, b: Uint8Array): number[] {
  return [...a.keys()].filter((i) => a[i] === b[i]);
}

// ---------------------------------------------------------------------------
// Digest comparison: every byte counts, wherever the difference sits.
// ---------------------------------------------------------------------------

const DIGEST_A = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 1) & 0xff);

function digestDifferingAt(positions: number[]): Uint8Array {
  const copy = DIGEST_A.slice();
  for (const i of positions) copy[i] ^= 0x01;
  return copy;
}

Deno.test('digestsEqual: equal digests (distinct arrays) are equal', () => {
  assertEquals(digestsEqual(DIGEST_A, DIGEST_A.slice()), true, 'equal');
});

Deno.test('digestsEqual: digests that differ at byte 0 only are not equal', () => {
  assertEquals(digestsEqual(DIGEST_A, digestDifferingAt([0])), false, 'equal');
});

Deno.test('digestsEqual: digests that differ at a middle byte only are not equal', () => {
  assertEquals(digestsEqual(DIGEST_A, digestDifferingAt([16])), false, 'equal');
});

Deno.test('digestsEqual: digests that differ at the last byte only are not equal', () => {
  assertEquals(digestsEqual(DIGEST_A, digestDifferingAt([31])), false, 'equal');
});

Deno.test('digestsEqual: a difference at any single position is detected', () => {
  for (let i = 0; i < DIGEST_A.length; i++) {
    assertEquals(digestsEqual(DIGEST_A, digestDifferingAt([i])), false, `differ at byte ${i}`);
  }
});

Deno.test('digestsEqual: digests that differ in every byte are not equal', () => {
  const all = [...DIGEST_A.keys()];
  assertEquals(digestsEqual(DIGEST_A, digestDifferingAt(all)), false, 'equal');
});

Deno.test('digestsEqual: arrays of different length are not equal', () => {
  assertEquals(digestsEqual(DIGEST_A, DIGEST_A.slice(0, 31)), false, 'shorter');
  assertEquals(digestsEqual(DIGEST_A.slice(0, 31), DIGEST_A), false, 'longer');
});

Deno.test(
  'tasks-feed fixtures: the collision tokens share exactly one digest byte with the right token',
  async () => {
    const right = await sha256(FEED_TOKEN);
    const first = equalPositions(await sha256(FIRST_BYTE_ONLY_TOKEN), right);
    const last = equalPositions(await sha256(LAST_BYTE_ONLY_TOKEN), right);
    assertEquals(JSON.stringify(first), '[0]', 'positions shared by the first-byte token');
    assertEquals(JSON.stringify(last), '[31]', 'positions shared by the last-byte token');
  },
);

// ---------------------------------------------------------------------------
// Missing or too short secret: fail closed, before anything else.
// ---------------------------------------------------------------------------

const MIN_SECRET_LENGTH = 32;
const SHORT_SECRET = 'a'.repeat(MIN_SECRET_LENGTH - 1);

const missingSecrets: Array<[string, string | undefined, string | undefined]> = [
  ['unset', undefined, `Bearer ${FEED_TOKEN}`],
  // An empty secret must not let an empty bearer (or anything else) compare equal.
  ['empty', '', 'Bearer '],
  ['empty with a bearer', '', `Bearer ${FEED_TOKEN}`],
  // A guessable secret is a misconfiguration even when the caller presents it exactly.
  ['shorter than 32 characters', SHORT_SECRET, `Bearer ${SHORT_SECRET}`],
];

for (const [label, token, header] of missingSecrets) {
  for (const method of ['GET', 'POST']) {
    Deno.test(
      `tasks-feed: ${method} gets 500 and no work when TASKS_FEED_TOKEN is ${label}`,
      async () => {
        const calls = await withStubs({ token }, async () => {
          const res = await handler(request(method, header));
          assertEquals(res.status, 500, 'status');
          assertEquals(res.headers.get('Content-Type'), 'application/json', 'content-type');
          const body = await res.json();
          assertEquals(body.error, 'Server misconfigured', 'error');
        });
        assertEquals(calls.length, 0, 'fetch calls');
      },
    );
  }
}

Deno.test('tasks-feed: a secret of exactly 32 characters is accepted', async () => {
  const secret = 'b'.repeat(MIN_SECRET_LENGTH);
  await withStubs({ token: secret, respond: () => postgrestOk([]) }, async () => {
    const res = await handler(request('GET', `Bearer ${secret}`));
    assertEquals(res.status, 200, 'status');
    assertEquals(await res.text(), '[]', 'body');
  });
});

// ---------------------------------------------------------------------------
// Authentication: 401 and no work.
// ---------------------------------------------------------------------------

const rejected: Array<[string, string | undefined]> = [
  ['no Authorization header', undefined],
  ['non-Bearer scheme', `Basic ${FEED_TOKEN}`],
  ['scheme without a token', 'Bearer'],
  ['empty bearer', 'Bearer '],
  ['wrong token', 'Bearer not-the-feed-token'],
  [
    'wrong token whose hash shares only the first byte with the right one',
    `Bearer ${FIRST_BYTE_ONLY_TOKEN}`,
  ],
  [
    'wrong token whose hash shares only the last byte with the right one',
    `Bearer ${LAST_BYTE_ONLY_TOKEN}`,
  ],
  ['token that is a prefix of the right one', `Bearer ${FEED_TOKEN.slice(0, -1)}`],
  ['right token plus extra characters', `Bearer ${FEED_TOKEN}x`],
  ['right token as a prefix of a longer value', `Bearer ${FEED_TOKEN}.signature`],
  ['the service-role key', `Bearer ${FAKE_SERVICE_KEY}`],
  ['a JWT claiming the service role', `Bearer ${jwt({ role: 'service_role' })}`],
];

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

for (const [label, header] of rejected) {
  Deno.test(`tasks-feed: 401 and no work for ${label}`, async () => {
    const calls = await withStubs({ token: FEED_TOKEN }, async () => {
      const res = await handler(request('GET', header));
      assertEquals(res.status, 401, 'status');
      assertEquals(res.headers.get('Content-Type'), 'application/json', 'content-type');
      const text = await res.text();
      assertEquals(JSON.parse(text).error, 'Unauthorized', 'error');
      assertNoLeak(text, FEED_TOKEN, 'body');
    });
    assertEquals(calls.length, 0, 'fetch calls');
  });
}

// ---------------------------------------------------------------------------
// Method check runs after auth: 401 for the unauthenticated, 405 for the authenticated.
// ---------------------------------------------------------------------------

Deno.test('tasks-feed: 401 (not 405) for an unauthenticated POST', async () => {
  const calls = await withStubs({ token: FEED_TOKEN }, async () => {
    const res = await handler(request('POST'));
    assertEquals(res.status, 401, 'status');
  });
  assertEquals(calls.length, 0, 'fetch calls');
});

Deno.test('tasks-feed: 401 (not 405) for a POST with a wrong token', async () => {
  const calls = await withStubs({ token: FEED_TOKEN }, async () => {
    const res = await handler(request('POST', 'Bearer not-the-feed-token'));
    assertEquals(res.status, 401, 'status');
  });
  assertEquals(calls.length, 0, 'fetch calls');
});

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  Deno.test(`tasks-feed: 405 and no work for ${method} with the right token`, async () => {
    const calls = await withStubs({ token: FEED_TOKEN }, async () => {
      const res = await handler(request(method, `Bearer ${FEED_TOKEN}`));
      assertEquals(res.status, 405, 'status');
      assertEquals(res.headers.get('Content-Type'), 'application/json', 'content-type');
      assertEquals(res.headers.get('Allow'), 'GET', 'allow');
      await res.body?.cancel();
    });
    assertEquals(calls.length, 0, 'fetch calls');
  });
}

// ---------------------------------------------------------------------------
// GET with the right token: query the tasks table and pass the rows through.
// ---------------------------------------------------------------------------

const ROWS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    project: 'example-project',
    title: 'Write the example',
    status: 'in_progress',
    priority: 2,
    metadata: { labels: ['a', 'b'], nested: { n: 1, flag: true, none: null } },
    updated_at: '2026-10-01T12:34:56.789012+00:00',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    project: null,
    title: 'Task with null project and priority',
    status: 'open',
    priority: null,
    metadata: {},
    updated_at: '2026-09-30T00:00:00+00:00',
  },
];

function postgrestOk(rows: unknown): Response {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.test(
  'tasks-feed: 200 with the PostgREST rows unchanged for GET with the right token',
  async () => {
    const calls = await withStubs(
      { token: FEED_TOKEN, respond: () => postgrestOk(ROWS) },
      async () => {
        const res = await handler(request('GET', `Bearer ${FEED_TOKEN}`));
        assertEquals(res.status, 200, 'status');
        assertEquals(res.headers.get('Content-Type'), 'application/json', 'content-type');
        const text = await res.text();
        const body = JSON.parse(text);
        assertEquals(Array.isArray(body), true, 'body is an array');
        assertEquals(text, JSON.stringify(ROWS), 'body');
        assertNoLeak(text, FEED_TOKEN, 'body');
      },
    );

    assertEquals(calls.length, 1, 'fetch calls');
    const call = calls[0];
    assertEquals(call.method, 'GET', 'method');
    assertEquals(call.url.origin, FAKE_URL, 'origin');
    assertEquals(call.url.pathname, '/rest/v1/tasks', 'path');
    assertEquals(call.url.searchParams.get('select'), SELECT, 'select');
    assertEquals(call.url.searchParams.get('deleted_at'), 'is.null', 'deleted_at filter');
    assertEquals(call.url.searchParams.get('status'), 'neq.cancelled', 'status filter');
    assertEquals(call.url.searchParams.get('limit'), '2000', 'limit');
    assertEquals(
      [...call.url.searchParams.keys()].sort().join(','),
      'deleted_at,limit,select,status',
      'query parameters',
    );
    // The database is queried as the service role; the feed token never leaves the function.
    assertEquals(call.headers.get('apikey'), FAKE_SERVICE_KEY, 'apikey header');
    assertEquals(call.headers.get('Authorization'), `Bearer ${FAKE_SERVICE_KEY}`, 'authorization');
    assertNoLeak(call.url.href, FEED_TOKEN, 'outbound url');
    for (const [, value] of call.headers) assertNoLeak(value, FEED_TOKEN, 'outbound header');
  },
);

Deno.test('tasks-feed: 200 with an empty array when there are no tasks', async () => {
  await withStubs({ token: FEED_TOKEN, respond: () => postgrestOk([]) }, async () => {
    const res = await handler(request('GET', `Bearer ${FEED_TOKEN}`));
    assertEquals(res.status, 200, 'status');
    assertEquals(await res.text(), '[]', 'body');
  });
});

// ---------------------------------------------------------------------------
// Database failures: 500 with a generic message.
// ---------------------------------------------------------------------------

Deno.test('tasks-feed: 500 with a generic message when PostgREST returns an error', async () => {
  const internal = 'permission denied for table tasks (internal detail)';
  const calls = await withStubs(
    {
      token: FEED_TOKEN,
      respond: () =>
        new Response(
          JSON.stringify({ code: '42501', message: internal, details: null, hint: null }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    },
    async () => {
      const res = await handler(request('GET', `Bearer ${FEED_TOKEN}`));
      assertEquals(res.status, 500, 'status');
      assertEquals(res.headers.get('Content-Type'), 'application/json', 'content-type');
      const text = await res.text();
      assertEquals(JSON.parse(text).error, 'Internal error', 'error');
      assertNoLeak(text, internal, 'body');
      assertNoLeak(text, '42501', 'body');
      assertNoLeak(text, FEED_TOKEN, 'body');
    },
  );
  assertEquals(calls.length, 1, 'fetch calls');
});

Deno.test('tasks-feed: 500 with a generic message when the database call throws', async () => {
  await withStubs(
    {
      token: FEED_TOKEN,
      respond: () => {
        throw new Error('connection refused (internal detail)');
      },
    },
    async () => {
      const res = await handler(request('GET', `Bearer ${FEED_TOKEN}`));
      assertEquals(res.status, 500, 'status');
      const text = await res.text();
      assertEquals(JSON.parse(text).error, 'Internal error', 'error');
      assertNoLeak(text, 'internal detail', 'body');
    },
  );
});

Deno.test(
  'tasks-feed: 500 with a generic message when the Supabase client cannot be created',
  async () => {
    const calls = await withStubs({ token: FEED_TOKEN, supabaseUrl: 'not a url' }, async () => {
      const res = await handler(request('GET', `Bearer ${FEED_TOKEN}`));
      assertEquals(res.status, 500, 'status');
      assertEquals(JSON.parse(await res.text()).error, 'Internal error', 'error');
    });
    assertEquals(calls.length, 0, 'fetch calls');
  },
);

Deno.test('tasks-feed: 500 and no work when the Supabase URL is missing', async () => {
  const calls = await withStubs({ token: FEED_TOKEN, supabaseUrl: '' }, async () => {
    const res = await handler(request('GET', `Bearer ${FEED_TOKEN}`));
    assertEquals(res.status, 500, 'status');
    assertEquals(JSON.parse(await res.text()).error, 'Server misconfigured', 'error');
  });
  assertEquals(calls.length, 0, 'fetch calls');
});
