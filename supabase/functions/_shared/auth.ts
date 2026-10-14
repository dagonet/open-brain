// Service-role auth guard shared by the edge functions that spend LLM tokens
// (compile-wiki, detect-contradictions). Dependency-free so vitest can import
// it as well as Deno.
//
// Two accepted credentials:
//   1. A Bearer JWT whose payload has role === 'service_role'. The Supabase
//      gateway (verify_jwt) validates the signature before our code runs, so
//      only the already-verified claim is read here.
//   2. A Bearer value exactly equal to this function's SUPABASE_SERVICE_ROLE_KEY
//      env value. Needed because callers (e.g. the MCP tools) send the raw env
//      value, which may be the new `sb_secret_...` format and is not a JWT.
//
// Never log the header or the key.

function hasServiceRoleClaim(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const payload = JSON.parse(atob(b64)) as { role?: string } | null;
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

// Constant-time string comparison (length is not hidden; the key length is not secret).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function isServiceRoleAuthorized(
  authHeader: string | null | undefined,
  serviceRoleKey: string | null | undefined,
): boolean {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  if (!token) return false;
  if (serviceRoleKey && timingSafeEqual(token, serviceRoleKey)) return true;
  return hasServiceRoleClaim(token);
}
