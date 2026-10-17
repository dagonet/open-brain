// Handler-level tests for the slack-webhook edge function: Slack request-signature check.
//
// Run (from the repo root; also run in CI, job "Edge Functions (Deno)"):
//   deno test --node-modules-dir=none --allow-env supabase/functions/slack-webhook_test.ts
//
// The zero-fetch assertions on rejected requests must be able to fail: the signed body is
// a real message event, the Supabase/OpenAI env is set so processing WOULD call fetch, and
// the positive control below proves that a valid request does. Background work is handed
// to a stubbed EdgeRuntime.waitUntil and drained before the counters are read.
// All values below are made-up fixtures.

import { handler } from './slack-webhook/handler.ts';

const SECRET = 'fake-slack-signing-secret';
const MESSAGE_EVENT = {
  type: 'message',
  text: 'a thought',
  channel: 'C0FAKE',
  ts: '1700000000.000100',
};
const BODY = JSON.stringify({ type: 'event_callback', event: MESSAGE_EVENT });

function assertEquals<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function sign(timestamp: string, body: string, secret = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(`v0:${timestamp}:${body}`)),
  );
  return 'v0=' + Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function request(body: string, headers: Record<string, string>): Request {
  return new Request('http://localhost/functions/v1/slack-webhook', {
    method: 'POST',
    headers,
    body,
  });
}

// A request whose signature covers `signedBody` and whose body is `sentBody`.
async function signed(
  timestamp: string,
  overrides: Record<string, string | undefined> = {},
  signedBody = BODY,
  sentBody = signedBody,
): Promise<Request> {
  const headers: Record<string, string> = {
    'X-Slack-Request-Timestamp': timestamp,
    'X-Slack-Signature': await sign(timestamp, signedBody),
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete headers[k];
    else headers[k] = v;
  }
  return request(sentBody, headers);
}

const ENV: Record<string, string> = {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key-for-tests',
  OPENAI_API_KEY: 'fake-openai-key-for-tests',
};

interface Outcome {
  status: number;
  text: string;
  fetchCalls: number;
  waitUntilCalls: number;
}

interface RunOptions {
  secret?: string | null; // null: leave SLACK_SIGNING_SECRET unset
  waitUntil?: boolean; // false: no EdgeRuntime at all (fallback path)
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// Runs the handler with env, fetch and EdgeRuntime stubbed, drains background work.
async function run(req: Request, options: RunOptions = {}): Promise<Outcome> {
  const secret = options.secret === undefined ? SECRET : options.secret;
  const realFetch = globalThis.fetch;
  const g = globalThis as { EdgeRuntime?: unknown };
  const prevRuntime = g.EdgeRuntime;
  const names = [...Object.keys(ENV), 'SLACK_SIGNING_SECRET'];
  const prev = names.map((n) => [n, Deno.env.get(n)] as const);
  const waited: Promise<unknown>[] = [];
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof fetch;
  if (options.waitUntil === false) delete g.EdgeRuntime;
  else g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => void waited.push(p) };
  for (const [k, v] of Object.entries(ENV)) Deno.env.set(k, v);
  if (secret === null) Deno.env.delete('SLACK_SIGNING_SECRET');
  else Deno.env.set('SLACK_SIGNING_SECRET', secret);
  try {
    const res = await handler(req);
    const text = await res.text();
    await Promise.allSettled(waited);
    // Fallback path: no promise was handed over, so give un-awaited work time to run.
    for (let i = 0; i < 10; i++) await tick();
    return { status: res.status, text, fetchCalls, waitUntilCalls: waited.length };
  } finally {
    globalThis.fetch = realFetch;
    if (prevRuntime === undefined) delete g.EdgeRuntime;
    else g.EdgeRuntime = prevRuntime;
    for (const [k, v] of prev) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

async function expectRejected(req: Request, status = 401, options: RunOptions = {}) {
  const out = await run(req, options);
  assertEquals(out.status, status, 'status');
  assertEquals(out.fetchCalls, 0, 'fetch calls');
  assertEquals(out.waitUntilCalls, 0, 'background work started');
}

async function expectAccepted(req: Request) {
  const out = await run(req);
  assertEquals(out.status, 200, 'status');
  assertEquals(out.waitUntilCalls, 1, 'background work handed to waitUntil');
}

// ---------------------------------------------------------------------------
// Positive controls: a valid request does start work, so the zero-fetch checks bite.
// ---------------------------------------------------------------------------

Deno.test('slack-webhook: a validly signed message event is accepted and calls fetch', async () => {
  const out = await run(await signed(String(nowSeconds())));
  assertEquals(out.status, 200, 'status');
  assertEquals(out.fetchCalls > 0, true, `fetch calls (${out.fetchCalls})`);
  assertEquals(out.waitUntilCalls, 1, 'processing promise handed to EdgeRuntime.waitUntil');
});

Deno.test('slack-webhook: without EdgeRuntime the work still runs (fallback)', async () => {
  const out = await run(await signed(String(nowSeconds())), { waitUntil: false });
  assertEquals(out.status, 200, 'status');
  assertEquals(out.waitUntilCalls, 0, 'waitUntil calls');
  assertEquals(out.fetchCalls > 0, true, `fetch calls (${out.fetchCalls})`);
});

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

Deno.test('slack-webhook: 401 for a wrong signature', async () => {
  const ts = String(nowSeconds());
  await expectRejected(await signed(ts, { 'X-Slack-Signature': await sign(ts, BODY, 'other') }));
});

Deno.test('slack-webhook: 401 for a signature of the wrong length', async () => {
  await expectRejected(await signed(String(nowSeconds()), { 'X-Slack-Signature': 'v0=abc' }));
});

Deno.test('slack-webhook: 401 for a missing signature', async () => {
  await expectRejected(await signed(String(nowSeconds()), { 'X-Slack-Signature': undefined }));
});

Deno.test('slack-webhook: 401 for a missing timestamp', async () => {
  await expectRejected(
    await signed(String(nowSeconds()), { 'X-Slack-Request-Timestamp': undefined }),
  );
});

Deno.test('slack-webhook: 401 when SLACK_SIGNING_SECRET is not set', async () => {
  await expectRejected(await signed(String(nowSeconds())), 401, { secret: null });
});

Deno.test('slack-webhook: 405 for a non-POST request, before anything else', async () => {
  const req = new Request('http://localhost/functions/v1/slack-webhook', { method: 'GET' });
  await expectRejected(req, 405);
});

// ---------------------------------------------------------------------------
// Raw-body binding: the signature covers the exact bytes Slack sent.
// ---------------------------------------------------------------------------

Deno.test('slack-webhook: 401 when the body differs from the signed one', async () => {
  const tampered = JSON.stringify({
    type: 'event_callback',
    event: { ...MESSAGE_EVENT, text: 'something else' },
  });
  await expectRejected(await signed(String(nowSeconds()), {}, BODY, tampered));
});

Deno.test(
  'slack-webhook: a signed body with unusual spacing and key order is accepted',
  async () => {
    const odd =
      '{\n  "event" : { "ts":"1700000000.000100",   "channel": "C0FAKE", "text":"a thought",\t"type":"message" },\n  "type":   "event_callback" }';
    assertEquals(odd === JSON.stringify(JSON.parse(odd)), false, 'fixture is not canonical JSON');
    await expectAccepted(await signed(String(nowSeconds()), {}, odd));
  },
);

// ---------------------------------------------------------------------------
// Timestamp: digits only, inside the 5-minute window.
// ---------------------------------------------------------------------------

// Non-numeric timestamps, signed for that exact string (the signer has the secret).
for (const bad of ['abc', '', '12abc', '-5', '1e3', 'NaN', 'Infinity', ' 1 ']) {
  Deno.test(`slack-webhook: 401 for the non-numeric timestamp '${bad}'`, async () => {
    await expectRejected(await signed(bad));
  });
}

// Strings Number() turns into the current time but that are not plain digits.
const nowForms: Array<[string, () => string]> = [
  ['hex', () => '0x' + nowSeconds().toString(16)],
  ['decimal point', () => `${nowSeconds()}.0`],
  ['exponent', () => `${nowSeconds()}e0`],
  ['leading plus', () => `+${nowSeconds()}`],
];
for (const [label, make] of nowForms) {
  Deno.test(`slack-webhook: 401 for a near-now timestamp in ${label} form`, async () => {
    const ts = make();
    assertEquals(Math.abs(Number(ts) - nowSeconds()) < 5, true, 'fixture parses as now');
    await expectRejected(await signed(ts));
  });
}

Deno.test('slack-webhook: 401 for a timestamp that is too old', async () => {
  await expectRejected(await signed(String(nowSeconds() - 6 * 60)));
});

Deno.test('slack-webhook: 401 for a timestamp too far in the future', async () => {
  await expectRejected(await signed(String(nowSeconds() + 6 * 60)));
});

// ---------------------------------------------------------------------------
// url_verification: signed by Slack like every other request.
// ---------------------------------------------------------------------------

const CHALLENGE_BODY = JSON.stringify({ type: 'url_verification', challenge: 'challenge-123' });

Deno.test('slack-webhook: a signed url_verification echoes the challenge', async () => {
  const out = await run(await signed(String(nowSeconds()), {}, CHALLENGE_BODY));
  assertEquals(out.status, 200, 'status');
  assertEquals(JSON.parse(out.text).challenge, 'challenge-123', 'challenge');
  assertEquals(out.fetchCalls, 0, 'fetch calls');
});

Deno.test('slack-webhook: an unsigned url_verification gets 401, not the challenge', async () => {
  const out = await run(request(CHALLENGE_BODY, {}));
  assertEquals(out.status, 401, 'status');
  assertEquals(out.text.includes('challenge-123'), false, 'challenge echoed');
});

// ---------------------------------------------------------------------------
// Errors: generic 500, no echo of the error or the request.
// ---------------------------------------------------------------------------

Deno.test('slack-webhook: a signed body that is not JSON gets a generic 500', async () => {
  const broken = '{"secret-looking-field": not json';
  const out = await run(await signed(String(nowSeconds()), {}, broken));
  assertEquals(out.status, 500, 'status');
  assertEquals(out.text, JSON.stringify({ error: 'Internal error' }), 'body');
  assertEquals(out.fetchCalls, 0, 'fetch calls');
});
