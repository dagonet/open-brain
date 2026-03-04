import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { processThought } from "../_shared/process-thought.ts";

const FIVE_MINUTES = 5 * 60;

async function verifySlackSignature(
  headers: Headers,
  rawBody: string,
): Promise<boolean> {
  const signingSecret = Deno.env.get("SLACK_SIGNING_SECRET");
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET is not set");
    return false;
  }

  const signature = headers.get("X-Slack-Signature");
  const timestamp = headers.get("X-Slack-Request-Timestamp");

  if (!signature || !timestamp) {
    return false;
  }

  // Reject requests older than 5 minutes (replay attack prevention)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > FIVE_MINUTES) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(sigBasestring),
  );

  const computed = "v0=" + Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

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

async function postSlackReply(
  channel: string,
  threadTs: string,
  text: string,
): Promise<void> {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) {
    console.error("SLACK_BOT_TOKEN is not set, skipping reply");
    return;
  }

  const resp = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
    }),
  });

  if (!resp.ok) {
    console.error(JSON.stringify({
      error: "slack_reply_failed",
      status: resp.status,
    }));
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
  if (event.bot_id || event.subtype === "bot_message") return;

  // Ignore edits and deletes
  if (event.subtype === "message_changed" || event.subtype === "message_deleted") return;

  const text = event.text?.trim();
  if (!text || !event.channel || !event.ts) return;

  const idempotencyKey = `${event.channel}:${event.ts}`;

  const result = await processThought({
    text,
    source: "slack",
    idempotency_key: idempotencyKey,
    metadata: {
      slack_channel: event.channel,
      slack_ts: event.ts,
      slack_thread_ts: event.thread_ts,
    },
  });

  console.log(JSON.stringify({
    event: "thought_captured",
    id: result.thought.id,
    thought_type: result.thought.thought_type,
    is_duplicate: result.is_duplicate,
    source: "slack",
  }));

  // Post confirmation reply
  const topics = result.thought.topics;
  const replyText = topics && topics.length > 0
    ? `✓ Captured as ${result.thought.thought_type}: ${topics.join(", ")}`
    : "✓ Thought captured";

  await postSlackReply(event.channel, event.ts, replyText);
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const body = JSON.parse(rawBody);

  // Handle Slack URL verification challenge (no signature check needed)
  if (body.type === "url_verification") {
    return new Response(
      JSON.stringify({ challenge: body.challenge }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Verify Slack signature
  const isValid = await verifySlackSignature(req.headers, rawBody);
  if (!isValid) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Process message events asynchronously
  const event = body.event as SlackEvent | undefined;
  if (event && event.type === "message") {
    processSlackEvent(event).catch((err) => {
      console.error(JSON.stringify({
        error: "slack_processing_failed",
        message: err.message,
      }));
    });
  }

  return new Response("ok", { status: 200 });
});
