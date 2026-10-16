// Lives in web/ so the gate's per-component vitest run executes it; the code under
// test (supabase/functions/_shared/auth.ts) is dependency-free and shared with Deno.
import { describe, it, expect } from 'vitest';
import { isServiceRoleAuthorized } from '../../../supabase/functions/_shared/auth';

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

const ENV_KEY = 'sb_secret_example_value';

describe('isServiceRoleAuthorized', () => {
  it('allows a JWT with role=service_role', () => {
    expect(isServiceRoleAuthorized(`Bearer ${jwt({ role: 'service_role' })}`, ENV_KEY)).toBe(true);
  });

  it('allows a service-role JWT even when the env key is unset', () => {
    expect(isServiceRoleAuthorized(`Bearer ${jwt({ role: 'service_role' })}`, '')).toBe(true);
  });

  it('allows a bearer exactly equal to the env service-role key', () => {
    expect(isServiceRoleAuthorized(`Bearer ${ENV_KEY}`, ENV_KEY)).toBe(true);
  });

  it('rejects a bearer that differs from the env key', () => {
    expect(isServiceRoleAuthorized(`Bearer ${ENV_KEY}x`, ENV_KEY)).toBe(false);
    expect(isServiceRoleAuthorized(`Bearer ${ENV_KEY.slice(0, -1)}`, ENV_KEY)).toBe(false);
  });

  it('never treats an empty bearer as matching an unset env key', () => {
    expect(isServiceRoleAuthorized('Bearer ', '')).toBe(false);
  });

  it('rejects an anon JWT', () => {
    expect(isServiceRoleAuthorized(`Bearer ${jwt({ role: 'anon' })}`, ENV_KEY)).toBe(false);
  });

  it('rejects an authenticated (user) JWT', () => {
    expect(
      isServiceRoleAuthorized(`Bearer ${jwt({ role: 'authenticated', sub: 'u1' })}`, ENV_KEY),
    ).toBe(false);
  });

  it('rejects a JWT without a role claim', () => {
    expect(isServiceRoleAuthorized(`Bearer ${jwt({ sub: 'u1' })}`, ENV_KEY)).toBe(false);
  });

  it('rejects a role claim nested under user_metadata', () => {
    expect(
      isServiceRoleAuthorized(
        `Bearer ${jwt({ role: 'authenticated', user_metadata: { role: 'service_role' } })}`,
        ENV_KEY,
      ),
    ).toBe(false);
  });

  it('rejects a lowercase bearer scheme', () => {
    expect(isServiceRoleAuthorized(`bearer ${jwt({ role: 'service_role' })}`, ENV_KEY)).toBe(false);
    expect(isServiceRoleAuthorized(`bearer ${ENV_KEY}`, ENV_KEY)).toBe(false);
  });

  it('rejects a missing or empty header', () => {
    expect(isServiceRoleAuthorized('', ENV_KEY)).toBe(false);
    expect(isServiceRoleAuthorized(null, ENV_KEY)).toBe(false);
  });

  it('rejects a header without the Bearer prefix', () => {
    expect(isServiceRoleAuthorized(jwt({ role: 'service_role' }), ENV_KEY)).toBe(false);
    expect(isServiceRoleAuthorized(ENV_KEY, ENV_KEY)).toBe(false);
  });

  it('rejects malformed JWTs', () => {
    expect(isServiceRoleAuthorized('Bearer not-a-jwt', ENV_KEY)).toBe(false);
    expect(isServiceRoleAuthorized('Bearer a.b', ENV_KEY)).toBe(false);
    expect(isServiceRoleAuthorized('Bearer a.!!!.c', ENV_KEY)).toBe(false);
    const notJson = Buffer.from('not json').toString('base64url');
    expect(isServiceRoleAuthorized(`Bearer a.${notJson}.c`, ENV_KEY)).toBe(false);
  });

  // run-nightly-jobs calls the guard with a null key: JWT role claim only.
  describe('with a null key (run-nightly-jobs)', () => {
    it('accepts a service-role JWT', () => {
      expect(isServiceRoleAuthorized(`Bearer ${jwt({ role: 'service_role' })}`, null)).toBe(true);
    });

    it('does not accept a bearer through the key-equality path', () => {
      expect(isServiceRoleAuthorized(`Bearer ${ENV_KEY}`, null)).toBe(false);
      expect(isServiceRoleAuthorized('Bearer null', null)).toBe(false);
      expect(isServiceRoleAuthorized('Bearer ', null)).toBe(false);
    });

    it('still rejects an anon JWT', () => {
      expect(isServiceRoleAuthorized(`Bearer ${jwt({ role: 'anon' })}`, null)).toBe(false);
    });
  });
});
