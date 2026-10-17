// tasks-feed edge function
//
// GET /functions/v1/tasks-feed
//   Authorization: Bearer <TASKS_FEED_TOKEN>
//
// Read-only task list for a local, server-side consumer (the agent dashboard) that
// has no Supabase session. Migration 016 revoked anon access to `tasks`, so this
// function reads the table with the service-role key and hands back the rows.
//
// Deployed with verify_jwt = false (supabase/config.toml): the caller has no
// Supabase JWT, so the gateway cannot authenticate it. The ONLY gate is the
// TASKS_FEED_TOKEN function secret checked below. Do NOT reuse
// isServiceRoleAuthorized from _shared/auth.ts here: it trusts the role claim of
// a JWT whose signature the gateway is expected to have verified, and with
// verify_jwt = false nobody verifies it, so a forged claim would pass.
//
// Order of checks (every response is application/json):
//   1. TASKS_FEED_TOKEN missing, empty or shorter than 32 characters -> 500, before
//      anything else (fail closed: an empty secret must never be compared, or an
//      empty bearer would match it, and a short one is too easy to guess). Nothing
//      is read from the request.
//   2. Missing/malformed header or wrong token -> 401.
//   3. Method other than GET -> 405. This runs AFTER auth, like compile-wiki and
//      detect-contradictions: unauthenticated callers get 401 whatever the method,
//      only authenticated callers learn about the method rule.
//   4. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing -> 500.
//   5. Query, newest first (updated_at desc, id asc). The 200 body is a plain JSON array;
//      X-Total-Count (exact number of matching rows) and X-Truncated (true when more
//      rows match than were returned) are response headers. A database error answers a generic 500, never the database message.
//
// Never log or echo the bearer value or the secret. No CORS headers: the consumer
// is not a browser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

// The fields the consumer reads. Same shape PostgREST returned to the anon client.
const TASK_COLUMNS = 'id,project,title,status,priority,metadata,updated_at';
const MAX_ROWS = 2000;
// `openssl rand -hex 32` gives 64 characters. A shorter secret is treated as a
// misconfiguration, because this token is the only access control.
const MIN_TOKEN_LENGTH = 32;

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

// Constant-time comparison of two digests: every byte is folded into `diff`, so the
// loop never exits early at the first difference. Only the lengths are compared up
// front, and those are public (SHA-256 digests are always 32 bytes). Exported for tests.
export function digestsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// Token check. Both values are hashed first, so the compared digests always have the
// same length: neither the content nor the length of the secret can be learned from
// the response time.
async function isAuthorized(authHeader: string | null, feedToken: string): Promise<boolean> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  if (!token) return false;
  const [given, expected] = await Promise.all([sha256(token), sha256(feedToken)]);
  return digestsEqual(given, expected);
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export async function handler(req: Request): Promise<Response> {
  const feedToken = Deno.env.get('TASKS_FEED_TOKEN');
  if (!feedToken || feedToken.length < MIN_TOKEN_LENGTH) {
    return jsonResponse(500, { error: 'Server misconfigured' });
  }

  if (!(await isAuthorized(req.headers.get('Authorization'), feedToken))) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' }, { Allow: 'GET' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(500, { error: 'Server misconfigured' });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error, count } = await supabase
      .from('tasks')
      .select(TASK_COLUMNS, { count: 'exact' })
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      // Newest first, id as tiebreaker: the cut at the row cap keeps the most recently
      // updated tasks, and the order is the same on every call.
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(MAX_ROWS);
    if (error) {
      console.error('tasks-feed: query failed', error.code, error.message);
      return jsonResponse(500, { error: 'Internal error' });
    }
    const rows = data ?? [];
    // The body stays a plain array. The total goes into headers so a consumer can tell
    // a cut list (PostgREST max_rows is below MAX_ROWS) from a complete one.
    const headers: Record<string, string> = {};
    if (typeof count === 'number' && Number.isFinite(count)) {
      headers['X-Total-Count'] = String(count);
      headers['X-Truncated'] = String(count > rows.length);
    }
    return jsonResponse(200, rows, headers);
  } catch (err) {
    console.error('tasks-feed: unexpected error', err instanceof Error ? err.message : 'unknown');
    return jsonResponse(500, { error: 'Internal error' });
  }
}
