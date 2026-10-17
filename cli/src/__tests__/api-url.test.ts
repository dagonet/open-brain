import { describe, it, expect } from 'vitest';
import { resolveApiEndpoints } from '../brain.js';

describe('resolveApiEndpoints', () => {
  it.each([
    [
      'hosted base URL',
      'https://abc.supabase.co',
      'https://abc.supabase.co/rest/v1',
      'https://abc.supabase.co/functions/v1',
      'https://abc.supabase.co/functions/v1/capture-thought',
    ],
    [
      'hosted function URL (legacy config)',
      'https://abc.supabase.co/functions/v1/capture-thought',
      'https://abc.supabase.co/rest/v1',
      'https://abc.supabase.co/functions/v1',
      'https://abc.supabase.co/functions/v1/capture-thought',
    ],
    [
      'local http URL with port',
      'http://127.0.0.1:54321',
      'http://127.0.0.1:54321/rest/v1',
      'http://127.0.0.1:54321/functions/v1',
      'http://127.0.0.1:54321/functions/v1/capture-thought',
    ],
    [
      'localhost with port and trailing slash',
      'http://localhost:54321/',
      'http://localhost:54321/rest/v1',
      'http://localhost:54321/functions/v1',
      'http://localhost:54321/functions/v1/capture-thought',
    ],
    [
      'hosted base URL with trailing slash',
      'https://abc.supabase.co/',
      'https://abc.supabase.co/rest/v1',
      'https://abc.supabase.co/functions/v1',
      'https://abc.supabase.co/functions/v1/capture-thought',
    ],
    [
      'legacy function URL with trailing slash',
      'https://abc.supabase.co/functions/v1/capture-thought/',
      'https://abc.supabase.co/rest/v1',
      'https://abc.supabase.co/functions/v1',
      'https://abc.supabase.co/functions/v1/capture-thought',
    ],
    [
      'local legacy function URL',
      'http://127.0.0.1:54321/functions/v1/capture-thought',
      'http://127.0.0.1:54321/rest/v1',
      'http://127.0.0.1:54321/functions/v1',
      'http://127.0.0.1:54321/functions/v1/capture-thought',
    ],
  ])('%s', (_name, input, rest, functions, capture) => {
    expect(resolveApiEndpoints(input)).toEqual({
      restBase: rest,
      functionsBase: functions,
      captureUrl: capture,
    });
  });

  it('rejects plain http for a remote host and prints only protocol//host', () => {
    expect(() => resolveApiEndpoints('http://abc.supabase.co/x?k=1', 'BRAIN_API_URL')).toThrow(
      /Refusing API URL in BRAIN_API_URL: plain http to http:\/\/abc\.supabase\.co is not allowed/,
    );
  });

  it.each([
    'http://127.0.0.1.evil.example',
    'http://127.0.0.1@evil.com',
    'http://localhost.evil',
    'http://[::2]:54321',
  ])('rejects look-alike local host %s over http', (input) => {
    expect(() => resolveApiEndpoints(input)).toThrow(/plain http/);
  });

  it('accepts an uppercase scheme and host for localhost', () => {
    expect(resolveApiEndpoints('HTTP://LOCALHOST:54321').restBase).toBe(
      'http://localhost:54321/rest/v1',
    );
  });

  it('accepts the IPv6 loopback over http', () => {
    expect(resolveApiEndpoints('http://[::1]:54321')).toEqual({
      restBase: 'http://[::1]:54321/rest/v1',
      functionsBase: 'http://[::1]:54321/functions/v1',
      captureUrl: 'http://[::1]:54321/functions/v1/capture-thought',
    });
  });

  it.each(['not-a-url', '', 'abc.supabase.co', 'ftp://abc.supabase.co'])(
    'rejects garbage input %j without echoing it',
    (input) => {
      expect(() => resolveApiEndpoints(input, 'BRAIN_API_URL')).toThrow(/BRAIN_API_URL/);
      try {
        resolveApiEndpoints(input, 'BRAIN_API_URL');
      } catch (err) {
        if (input) expect((err as Error).message).not.toContain(input);
      }
    },
  );
});
