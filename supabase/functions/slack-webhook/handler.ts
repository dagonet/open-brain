import { processThought } from '../_shared/process-thought.ts';

const FIVE_MINUTES = 5 * 60;

async function verifySlackSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const signingSecret = Deno.env.get('SLACK_SIGNING_SECRET');
  if (!signingSecret) {
    console.error('SLACK_SIGNING_SECRET is not set');
    return false;
  }

  const signature = headers.get('X-Slack-Signature');
  const timestamp = headers.get('X-Slack-Request-Timestamp');

  if (!signature || !timestamp) {
    return false;
  }

  // Digits only: a non-numeric value would make the window comparison below NaN (false).
  if (!/^\d+$/.test(timestamp)) {
    return false;
  }

  // Reject requests older than 5 minutes (replay attack prevention)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > FIVE_MINUTES) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(sigBasestring));

  const computed =
    'v0=' +
    Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  // Constant-time comparison
  if (computed.length !== signature.length) {
    return false;
  }
  const a = encoder.encode(computed);
  const b = encoder.encode(signature);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}

async function postSlackReply(channel: string, threadTs: string, text: string): Promise<void> {
  const token = Deno.env.get('SLACK_BOT_TOKEN');
  if (!token) {
    console.error('SLACK_BOT_TOKEN is not set, skipping reply');
    return;
  }

  const resp = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
    }),
  });

  if (!resp.ok) {
    console.error(
      JSON.stringify({
        error: 'slack_reply_failed',
        status: resp.status,
      }),
    );
  }
}

interface SlackEvent {
  type: string;
  subtype?: string;
  bot_id?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
}

async function processSlackEvent(event: SlackEvent): Promise<void> {
  // Ignore bot messages
  if (event.bot_id || event.subtype === 'bot_message') return;

  // Ignore edits and deletes
  if (event.subtype === 'message_changed' || event.subtype === 'message_deleted') return;

  const text = event.text?.trim();
  if (!text || !event.channel || !event.ts) return;

  const idempotencyKey = `${event.channel}:${event.ts}`;

  const result = await processThought({
    text,
    source: 'slack',
    idempotency_key: idempotencyKey,
    metadata: {
      slack_channel: event.channel,
      slack_ts: event.ts,
      slack_thread_ts: event.thread_ts,
    },
  });

  console.log(
    JSON.stringify({
      event: 'thought_captured',
      id: result.thought.id,
      thought_type: result.thought.thought_type,
      is_duplicate: result.is_duplicate,
      source: 'slack',
    }),
  );

  // Post confirmation reply
  const topics = result.thought.topics;
  const replyText =
    topics && topics.length > 0
      ? `✓ Captured as ${result.thought.thought_type}: ${topics.join(', ')}`
      : '✓ Thought captured';

  await postSlackReply(event.channel, event.ts, replyText);
}

export async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const rawBody = await req.text();

    // Verify the signature over the raw body BEFORE parsing it. Slack signs every
    // request, the url_verification handshake included, so unsigned callers only ever
    // get 405 or 401.
    const isValid = await verifySlackSignature(req.headers, rawBody);
    if (!isValid) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = JSON.parse(rawBody);

    // Handle Slack URL verification challenge
    if (body.type === 'url_verification') {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    dispatch(body);

    return new Response('ok', { status: 200 });
  } catch (err) {
    // Log the error object only (never the request body); answer generically.
    console.error('Slack webhook error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Process message events after the response. EdgeRuntime.waitUntil keeps the worker
// alive until the work finishes; without it (local runs, tests) the promise just runs on.
function dispatch(body: { event?: SlackEvent }): void {
  const event = body.event;
  if (!event || event.type !== 'message') return;
  const work = processSlackEvent(event).catch((err) => {
    console.error(
      JSON.stringify({
        error: 'slack_processing_failed',
        message: err.message,
      }),
    );
  });
  const runtime = (
    globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }
  ).EdgeRuntime;
  runtime?.waitUntil?.(work);
}
