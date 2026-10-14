import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditCommand, wikiRefreshCommand, requireServiceKey, loadConfig } from '../brain.js';

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

  let home: string;

  function writeConfigFile(cfg: Record<string, string>): void {
    mkdirSync(join(home, '.brain'), { recursive: true });
    writeFileSync(join(home, '.brain', 'config.json'), JSON.stringify(cfg));
  }

  beforeEach(() => {
    vi.resetAllMocks();
    home = mkdtempSync(join(tmpdir(), 'brain-cli-test-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('BRAIN_SERVICE_KEY', '');
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
    rmSync(home, { recursive: true, force: true });
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

  it('audit --resolve works without a service key (it uses the anon key via PostgREST)', async () => {
    process.argv = ['node', 'brain', 'audit', '--resolve', 'c1', '--decision', 'resolved'];
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 'c1', status: 'resolved' }],
    });

    await auditCommand();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/rest/v1/contradictions?id=eq.c1');
    expect(init.headers.Authorization).toBe(`Bearer ${ANON}`);
    expect(process.exit).not.toHaveBeenCalled();
  });

  describe('loadConfig service_key resolution', () => {
    it('reads service_key from the config file', () => {
      vi.stubEnv('BRAIN_API_URL', '');
      vi.stubEnv('BRAIN_API_KEY', '');
      writeConfigFile({
        api_url: `${URL_BASE}/capture-thought`,
        api_key: ANON,
        service_key: SERVICE,
      });

      expect(loadConfig()).toEqual({
        api_url: `${URL_BASE}/capture-thought`,
        api_key: ANON,
        service_key: SERVICE,
      });
    });

    it('reads service_key from the file even when url/key come from env', () => {
      writeConfigFile({ service_key: SERVICE });

      expect(loadConfig()?.api_key).toBe(ANON);
      expect(loadConfig()?.service_key).toBe(SERVICE);
    });

    it('BRAIN_SERVICE_KEY wins over the config file', () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', 'env-service-key');
      writeConfigFile({ service_key: SERVICE });

      expect(loadConfig()?.service_key).toBe('env-service-key');
    });

    it('ignores a config.json containing null: env mode works, file mode is not configured', () => {
      mkdirSync(join(home, '.brain'), { recursive: true });
      writeFileSync(join(home, '.brain', 'config.json'), 'null');

      expect(loadConfig()?.api_key).toBe(ANON);

      vi.stubEnv('BRAIN_API_URL', '');
      vi.stubEnv('BRAIN_API_KEY', '');
      expect(loadConfig()).toBeNull();
    });

    it('leaves service_key undefined when neither source has it', () => {
      expect(loadConfig()?.service_key).toBeUndefined();
    });
  });
});
