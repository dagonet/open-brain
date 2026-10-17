import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureSingleThought } from '../brain.js';

describe('failed fetch reports its cause', () => {
  let errors: string[];

  beforeEach(() => {
    process.env.BRAIN_API_URL = 'https://test-project.supabase.co';
    process.env.BRAIN_SERVICE_KEY = 'test-service-key';
    errors = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.join(' '));
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
  });

  afterEach(() => {
    delete process.env.BRAIN_API_URL;
    delete process.env.BRAIN_SERVICE_KEY;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('names the cause behind "fetch failed" (for example a refused redirect)', async () => {
    const failure = new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));

    await expect(captureSingleThought('a thought')).rejects.toThrow('exit:1');

    expect(errors.join('\n')).toContain('Could not reach the API (unexpected redirect)');
  });

  it('keeps the plain message when the error has no cause', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(captureSingleThought('a thought')).rejects.toThrow('exit:1');

    const printed = errors.join('\n');
    expect(printed).toContain('Could not reach the API. Check your connection');
    expect(printed).not.toContain('(');
  });
});
