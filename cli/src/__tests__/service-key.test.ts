import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { auditCommand, wikiRefreshCommand, requireServiceKey } from '../brain.js';

const URL_BASE = 'https://proj.supabase.co/functions/v1';
const ANON = 'anon-key-value';
const SERVICE = 'service-key-value';

describe('requireServiceKey', () => {
  it('returns the key when present', () => {
    expect(requireServiceKey({ service_key: SERVICE })).toBe(SERVICE);
  });

  it('throws naming both the env var and the config field when missing', () => {
    expect(() => requireServiceKey({})).toThrow(/BRAIN_SERVICE_KEY/);
    expect(() => requireServiceKey({})).toThrow(/service_key/);
  });
});

describe('service-role commands', () => {
  const fetchMock = vi.fn();
  const origArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, status: 'compiled', findings: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('BRAIN_API_URL', `${URL_BASE}/capture-thought`);
    vi.stubEnv('BRAIN_API_KEY', ANON);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
  });

  afterEach(() => {
    process.argv = origArgv;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('wiki refresh sends BRAIN_SERVICE_KEY, not the anon key', async () => {
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);

    await wikiRefreshCommand(['some-slug']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_BASE}/compile-wiki`);
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
  });

  it('audit sends BRAIN_SERVICE_KEY, not the anon key', async () => {
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
    process.argv = ['node', 'brain', 'audit'];

    await auditCommand();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_BASE}/detect-contradictions`);
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
  });

  it('wiki refresh fails fast without a service key and makes no request', async () => {
    vi.stubEnv('BRAIN_SERVICE_KEY', '');

    await expect(wikiRefreshCommand(['some-slug'])).rejects.toThrow('exit:1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain('BRAIN_SERVICE_KEY');
  });

  it('audit fails fast without a service key and makes no request', async () => {
    vi.stubEnv('BRAIN_SERVICE_KEY', '');
    process.argv = ['node', 'brain', 'audit'];

    await expect(auditCommand()).rejects.toThrow('exit:1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain('BRAIN_SERVICE_KEY');
  });
});
