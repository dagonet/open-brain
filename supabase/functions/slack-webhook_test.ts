// Handler-level tests for the slack-webhook edge function: Slack request-signature check.
//
// Run (from the repo root; also run in CI, job "Edge Functions (Deno)"):
//   deno test --node-modules-dir=none --allow-env supabase/functions/slack-webhook_test.ts
//
// Rejected requests must do no downstream work, so fetch is stubbed and every test
// checks the number of recorded calls. All values below are made-up fixtures.

import { handler } from './slack-webhook/handler.ts';

const SECRET = 'fake-slack-signing-secret';
// A body without a message event: an accepted request answers 200 and starts no work.
const BODY = JSON.stringify({ type: 'event_callback', event: { type: 'reaction_added' } });

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

async function signed(
  timestamp: string,
  overrides: Record<string, string | undefined> = {},
): Promise<Request> {
  const headers: Record<string, string> = {
    'X-Slack-Request-Timestamp': timestamp,
    'X-Slack-Signature': await sign(timestamp, BODY),
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete headers[k];
    else headers[k] = v;
  }
  return request(BODY, headers);
}

// Runs fn with env + fetch stubbed; returns the number of fetch calls it made.
async function withStubs(secret: string | undefined, fn: () => Promise<void>): Promise<number> {
  const realFetch = globalThis.fetch;
  const prev = Deno.env.get('SLACK_SIGNING_SECRET');
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    return Promise.reject(new Error('fetch must not be reached in this test'));
  }) as typeof fetch;
  if (secret === undefined) Deno.env.delete('SLACK_SIGNING_SECRET');
  else Deno.env.set('SLACK_SIGNING_SECRET', secret);
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    if (prev === undefined) Deno.env.delete('SLACK_SIGNING_SECRET');
    else Deno.env.set('SLACK_SIGNING_SECRET', prev);
  }
  return calls;
}

// secret null: leave SLACK_SIGNING_SECRET unset.
async function expectStatus(req: Request, status: number, secret: string | null = SECRET) {
  const calls = await withStubs(secret ?? undefined, async () => {
    const res = await handler(req);
    assertEquals(res.status, status, 'status');
    await res.text();
  });
  assertEquals(calls, 0, 'fetch calls');
}

Deno.test('slack-webhook: a valid signature is accepted', async () => {
  await expectStatus(await signed(String(nowSeconds())), 200);
});

Deno.test('slack-webhook: 401 for a wrong signature', async () => {
  const ts = String(nowSeconds());
  await expectStatus(await signed(ts, { 'X-Slack-Signature': await sign(ts, BODY, 'other') }), 401);
});

Deno.test('slack-webhook: 401 for a signature of the wrong length', async () => {
  await expectStatus(await signed(String(nowSeconds()), { 'X-Slack-Signature': 'v0=abc' }), 401);
});

Deno.test('slack-webhook: 401 for a missing signature', async () => {
  await expectStatus(await signed(String(nowSeconds()), { 'X-Slack-Signature': undefined }), 401);
});

Deno.test('slack-webhook: 401 for a missing timestamp', async () => {
  await expectStatus(
    await signed(String(nowSeconds()), { 'X-Slack-Request-Timestamp': undefined }),
    401,
  );
});

// A non-numeric timestamp must be rejected even when the signature is valid for that
// exact string (the signer has the secret): the window check alone would let it pass.
for (const bad of ['abc', '', '12abc', '-5', '1e3', 'NaN', 'Infinity', ' 1 ']) {
  Deno.test(`slack-webhook: 401 for the non-numeric timestamp '${bad}'`, async () => {
    await expectStatus(await signed(bad), 401);
  });
}

Deno.test('slack-webhook: 401 for a timestamp that is too old', async () => {
  await expectStatus(await signed(String(nowSeconds() - 6 * 60)), 401);
});

Deno.test('slack-webhook: 401 for a timestamp too far in the future', async () => {
  await expectStatus(await signed(String(nowSeconds() + 6 * 60)), 401);
});

Deno.test('slack-webhook: 401 when SLACK_SIGNING_SECRET is not set', async () => {
  await expectStatus(await signed(String(nowSeconds())), 401, null);
});

Deno.test('slack-webhook: url_verification echoes the challenge', async () => {
  const body = JSON.stringify({ type: 'url_verification', challenge: 'challenge-123' });
  const calls = await withStubs(SECRET, async () => {
    const res = await handler(request(body, {}));
    assertEquals(res.status, 200, 'status');
    assertEquals(JSON.parse(await res.text()).challenge, 'challenge-123', 'challenge');
  });
  assertEquals(calls, 0, 'fetch calls');
});
