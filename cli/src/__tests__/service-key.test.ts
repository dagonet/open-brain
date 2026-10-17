import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditCommand,
  describeFailure,
  importMemories,
  wikiRejectCommand,
  captureSingleThought,
  syncVault,
  wikiGetCommand,
  wikiListCommand,
  wikiRefreshCommand,
  requireServiceKey,
  loadConfig,
} from '../brain.js';

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

  it('audit --resolve patches PostgREST and captures with the service key', async () => {
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
    process.argv = ['node', 'brain', 'audit', '--resolve', 'c1', '--decision', 'resolved'];
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 'c1', status: 'resolved' }],
    });

    await auditCommand();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/rest/v1/contradictions?id=eq.c1');
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
    expect(init.headers.apikey).toBe(SERVICE);
    const [captureUrl, captureInit] = fetchMock.mock.calls[1];
    expect(captureUrl).toBe(`${URL_BASE}/capture-thought`);
    expect(captureInit.headers.Authorization).toBe(`Bearer ${SERVICE}`);
  });

  it('audit --resolve fails fast without a service key and makes no request', async () => {
    process.argv = ['node', 'brain', 'audit', '--resolve', 'c1', '--decision', 'resolved'];

    await expect(auditCommand()).rejects.toThrow('exit:1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain('BRAIN_SERVICE_KEY');
  });

  it('wiki get and list read PostgREST with the service key', async () => {
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    await wikiGetCommand(['some-slug']);
    await wikiListCommand([]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toContain('/rest/v1/current_wiki_pages');
      expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
      expect(init.headers.apikey).toBe(SERVICE);
    }
  });

  it('wiki get and list fail fast without a service key and make no request', async () => {
    await expect(wikiGetCommand(['some-slug'])).rejects.toThrow('exit:1');
    await expect(wikiListCommand([])).rejects.toThrow('exit:1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain('BRAIN_SERVICE_KEY');
  });

  it('wiki refresh --all reads topic_counts with the service key', async () => {
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    await wikiRefreshCommand(['--all']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/rest/v1/topic_counts');
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
  });

  it('sync-vault reads thoughts with the service key', async () => {
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
    process.argv = ['node', 'brain', 'sync-vault', join(home, 'vault'), '--dry-run'];
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    await syncVault();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/rest/v1/thoughts');
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
    expect(init.headers.apikey).toBe(SERVICE);
  });

  it('sync-vault fails fast without a service key and makes no request', async () => {
    process.argv = ['node', 'brain', 'sync-vault', join(home, 'vault'), '--dry-run'];

    await expect(syncVault()).rejects.toThrow('exit:1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain('BRAIN_SERVICE_KEY');
  });

  it('capture sends the service key to capture-thought, not the anon key', async () => {
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await captureSingleThought('hello');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_BASE}/capture-thought`);
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
  });

  it('capture fails fast without a service key and makes no request', async () => {
    await expect(captureSingleThought('hello')).rejects.toThrow('exit:1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain('BRAIN_SERVICE_KEY');
  });

  it('import sends the service key to capture-thought, not the anon key', async () => {
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
    const file = join(home, 'memories.txt');
    writeFileSync(file, 'first memory\n');
    process.argv = ['node', 'brain', 'import', file, '--delay', '0'];
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await importMemories();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_BASE}/capture-thought`);
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
  });

  it('import fails fast without a service key and makes no request', async () => {
    const file = join(home, 'memories.txt');
    writeFileSync(file, 'first memory\n');
    process.argv = ['node', 'brain', 'import', file];

    await expect(importMemories()).rejects.toThrow('exit:1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain('BRAIN_SERVICE_KEY');
  });

  it('wiki reject sends the service key to capture-thought, not the anon key', async () => {
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });

    await wikiRejectCommand(['page-1', '--reason', 'wrong']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_BASE}/capture-thought`);
    expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
  });

  it('wiki reject fails fast without a service key and makes no request', async () => {
    await expect(wikiRejectCommand(['page-1', '--reason', 'wrong'])).rejects.toThrow('exit:1');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain('BRAIN_SERVICE_KEY');
  });

  describe('failure reasons', () => {
    const errorOutput = (): string =>
      vi
        .mocked(console.error)
        .mock.calls.map((c) => String(c[0]))
        .join('\n');

    it('wiki refresh prints slug, status and error field for a failed slug', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'LLM exploded' }),
      });

      await wikiRefreshCommand(['some-slug']);

      expect(errorOutput()).toContain('some-slug');
      expect(errorOutput()).toContain('HTTP 500');
      expect(errorOutput()).toContain('LLM exploded');
      expect(errorOutput()).not.toContain('BRAIN_SERVICE_KEY');
      expect(vi.mocked(console.log).mock.calls.at(-1)?.[0]).toContain('errors 1');
    });

    it('wiki refresh adds the service-key hint on 401', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid JWT' }),
      });

      await wikiRefreshCommand(['some-slug']);

      expect(errorOutput()).toContain('HTTP 401: Invalid JWT');
      expect(errorOutput()).toContain('BRAIN_SERVICE_KEY');
      expect(errorOutput()).toContain('service_key');
      expect(errorOutput()).not.toContain(SERVICE);
    });

    it('audit prints status and error field, with the hint on 403', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
      process.argv = ['node', 'brain', 'audit'];
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden' }),
      });

      await expect(auditCommand()).rejects.toThrow('exit:1');

      expect(errorOutput()).toContain('HTTP 403: Forbidden');
      expect(errorOutput()).toContain('BRAIN_SERVICE_KEY');
    });

    it('wiki reject prints status and error field from a failed response', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      });

      await expect(wikiRejectCommand(['page-1', '--reason', 'wrong'])).rejects.toThrow('exit:1');

      expect(errorOutput()).toContain('HTTP 401: Unauthorized');
      expect(errorOutput()).toContain('BRAIN_SERVICE_KEY');
    });

    it('wiki list prints the PostgREST message for a failed read', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: 'relation does not exist' }),
      });

      await expect(wikiListCommand([])).rejects.toThrow('exit:1');

      expect(errorOutput()).toContain('HTTP 404: relation does not exist');
    });

    it('capture prints status and error field, with the hint on 401', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid JWT' }),
      });

      await expect(captureSingleThought('hello')).rejects.toThrow('exit:1');

      expect(errorOutput()).toContain('HTTP 401: Invalid JWT');
      expect(errorOutput()).toContain('BRAIN_SERVICE_KEY');
    });

    it('capture prints status and error field on a 500', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'embedding failed' }),
      });

      await expect(captureSingleThought('hello')).rejects.toThrow('exit:1');

      expect(errorOutput()).toContain('HTTP 500: embedding failed');
    });

    it('import reports status and error, even for a non-JSON body', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
      const file = join(home, 'memories.txt');
      writeFileSync(file, 'first memory\nsecond memory\n');
      process.argv = ['node', 'brain', 'import', file, '--delay', '0'];
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Invalid JWT' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          json: async () => {
            throw new SyntaxError('Unexpected token <');
          },
        });

      await importMemories();

      const logged = vi
        .mocked(console.log)
        .mock.calls.map((c) => String(c[0]))
        .join('\n');
      expect(logged).toContain('HTTP 401: Invalid JWT');
      expect(logged).toContain('BRAIN_SERVICE_KEY');
      expect(logged).toContain('HTTP 502');
      expect(logged).toContain('2 failed');
    });

    it('audit --resolve reports a failed follow-up capture', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
      process.argv = ['node', 'brain', 'audit', '--resolve', 'c1', '--decision', 'resolved'];
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ id: 'c1', status: 'resolved' }],
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Invalid JWT' }),
        });

      await auditCommand();

      expect(errorOutput()).toContain('audit thought capture failed');
      expect(errorOutput()).toContain('HTTP 401: Invalid JWT');
    });

    it('audit --verbose reports a failed contradictions listing', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
      process.argv = ['node', 'brain', 'audit', '--verbose'];
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ contradictions_inserted: 1 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({ message: 'permission denied' }),
        });

      await auditCommand();

      expect(errorOutput()).toContain('HTTP 403: permission denied');
    });

    it('sync-vault reports the status and body of a failed read', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
      process.argv = ['node', 'brain', 'sync-vault', join(home, 'vault')];
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid API key' }),
      });

      await expect(syncVault()).rejects.toThrow();

      const all = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
        .map((c) => String(c[0]))
        .join('\n');
      expect(all).toContain('HTTP 401: Invalid API key');
    });

    it('describeFailure copes with a non-object body', () => {
      expect(describeFailure(502, null)).toBe('HTTP 502');
      expect(describeFailure(502, 'oops')).toBe('HTTP 502');
    });
  });

  describe('loadConfig without api_key', () => {
    it('is configured by api_url alone (env)', () => {
      vi.stubEnv('BRAIN_API_KEY', '');

      expect(loadConfig()?.api_url).toBe(`${URL_BASE}/capture-thought`);
      expect(loadConfig()?.api_key).toBeUndefined();
    });

    it('is configured by api_url alone (file)', () => {
      vi.stubEnv('BRAIN_API_URL', '');
      vi.stubEnv('BRAIN_API_KEY', '');
      writeConfigFile({ api_url: `${URL_BASE}/capture-thought`, service_key: SERVICE });

      expect(loadConfig()).toEqual({
        api_url: `${URL_BASE}/capture-thought`,
        api_key: undefined,
        service_key: SERVICE,
      });
    });

    it('resolves each field on its own: env api_url with file api_key', () => {
      vi.stubEnv('BRAIN_API_KEY', '');
      writeConfigFile({ api_url: 'https://file.supabase.co/x', api_key: 'file-anon' });

      expect(loadConfig()).toMatchObject({
        api_url: `${URL_BASE}/capture-thought`,
        api_key: 'file-anon',
      });
    });

    it('resolves each field on its own: file api_url with env api_key', () => {
      vi.stubEnv('BRAIN_API_URL', '');
      writeConfigFile({ api_url: 'https://file.supabase.co/functions/v1/capture-thought' });

      expect(loadConfig()).toMatchObject({
        api_url: 'https://file.supabase.co/functions/v1/capture-thought',
        api_key: ANON,
      });
    });

    it('is not configured without api_url', () => {
      vi.stubEnv('BRAIN_API_URL', '');
      vi.stubEnv('BRAIN_API_KEY', '');
      writeConfigFile({ service_key: SERVICE });

      expect(loadConfig()).toBeNull();
    });
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
