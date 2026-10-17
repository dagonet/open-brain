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

  it('rejects plain http for a remote host', () => {
    expect(() => resolveApiEndpoints('http://abc.supabase.co')).toThrow(
      /plain http is only allowed for localhost or 127\.0\.0\.1/,
    );
    expect(() => resolveApiEndpoints('http://127.0.0.1.evil.example')).toThrow(/plain http/);
  });

  it.each(['not-a-url', '', 'abc.supabase.co', 'ftp://abc.supabase.co'])(
    'rejects garbage input %j',
    (input) => {
      expect(() => resolveApiEndpoints(input)).toThrow(/BRAIN_API_URL/);
    },
  );
});
