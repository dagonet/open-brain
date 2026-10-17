import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditCommand,
  captureSingleThought,
  importMemories,
  loadConfig,
  syncVault,
  wikiGetCommand,
  wikiListCommand,
  wikiRefreshCommand,
  wikiRejectCommand,
} from '../brain.js';

const SERVICE = 'service-key-value';
const JWT_LIKE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl';
const CAPTURE = 'https://abc.supabase.co/functions/v1/capture-thought';

describe('api_url handling in loadConfig and commands', () => {
  const fetchMock = vi.fn();
  const origArgv = process.argv;
  let home: string;

  function writeConfigFile(cfg: Record<string, string>): void {
    mkdirSync(join(home, '.brain'), { recursive: true });
    writeFileSync(join(home, '.brain', 'config.json'), JSON.stringify(cfg));
  }

  const everythingPrinted = (): string =>
    [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls]
      .map((c) => c.map(String).join(' '))
      .join('\n');

  beforeEach(() => {
    vi.resetAllMocks();
    home = mkdtempSync(join(tmpdir(), 'brain-cli-url-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('BRAIN_API_URL', '');
    vi.stubEnv('BRAIN_API_KEY', '');
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, status: 'compiled', findings: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
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

  describe('loadConfig', () => {
    it('turns a bare base URL from the environment into the capture URL and endpoints', () => {
      vi.stubEnv('BRAIN_API_URL', 'https://abc.supabase.co');
      expect(loadConfig()).toMatchObject({
        api_url: CAPTURE,
        endpoints: {
          captureUrl: CAPTURE,
          functionsBase: 'https://abc.supabase.co/functions/v1',
          restBase: 'https://abc.supabase.co/rest/v1',
        },
      });
    });

    it('turns a bare base URL from the config file into the capture URL and endpoints', () => {
      writeConfigFile({ api_url: 'http://127.0.0.1:54321/' });
      expect(loadConfig()).toMatchObject({
        api_url: 'http://127.0.0.1:54321/functions/v1/capture-thought',
        endpoints: { restBase: 'http://127.0.0.1:54321/rest/v1' },
      });
    });

    it('passes the legacy capture URL through unchanged', () => {
      vi.stubEnv('BRAIN_API_URL', CAPTURE);
      expect(loadConfig()?.api_url).toBe(CAPTURE);
      vi.stubEnv('BRAIN_API_URL', '');
      writeConfigFile({ api_url: CAPTURE });
      expect(loadConfig()?.api_url).toBe(CAPTURE);
    });

    it('throws for remote http from the environment, naming BRAIN_API_URL', () => {
      vi.stubEnv('BRAIN_API_URL', 'http://abc.supabase.co');
      expect(() => loadConfig()).toThrow(/BRAIN_API_URL/);
      expect(() => loadConfig()).toThrow(/plain http/);
    });

    it('throws for remote http from the config file, naming api_url in the file', () => {
      writeConfigFile({ api_url: 'http://abc.supabase.co' });
      expect(() => loadConfig()).toThrow(/api_url in ~\/\.brain\/config\.json/);
      expect(() => loadConfig()).toThrow(/plain http/);
    });

    it('never puts a JWT-like value or credentials in the error message', () => {
      const messages: string[] = [];
      for (const [source, value] of [
        ['env', JWT_LIKE],
        ['file', JWT_LIKE],
        ['env', 'http://admin:s3cret@abc.supabase.co/x?token=abc'],
        ['file', 'http://admin:s3cret@abc.supabase.co/x?token=abc'],
      ]) {
        vi.stubEnv('BRAIN_API_URL', source === 'env' ? value : '');
        if (source === 'file') writeConfigFile({ api_url: value });
        try {
          loadConfig();
          messages.push('NO ERROR');
        } catch (err) {
          messages.push((err as Error).message);
        }
      }
      for (const m of messages) {
        expect(m).not.toBe('NO ERROR');
        expect(m).not.toContain(JWT_LIKE);
        expect(m).not.toContain('eyJ');
        expect(m).not.toContain('s3cret');
        expect(m).not.toContain('admin');
        expect(m).not.toContain('token=');
      }
      expect(messages[0]).toMatch(/^Invalid API URL in BRAIN_API_URL\./);
      expect(messages[3]).toContain('http://abc.supabase.co');
    });
  });

  describe('import --dry-run', () => {
    it('does not fail on an invalid or refused URL and sends nothing', async () => {
      const file = join(home, 'memories.txt');
      writeFileSync(file, 'first memory\n');
      process.argv = ['node', 'brain', 'import', file, '--dry-run'];
      for (const bad of ['not-a-url', 'http://abc.supabase.co']) {
        vi.stubEnv('BRAIN_API_URL', bad);
        await expect(importMemories()).resolves.toBeUndefined();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still fails on an invalid URL without --dry-run', async () => {
      const file = join(home, 'memories.txt');
      writeFileSync(file, 'first memory\n');
      process.argv = ['node', 'brain', 'import', file, '--delay', '0'];
      vi.stubEnv('BRAIN_API_URL', 'http://abc.supabase.co');
      await expect(importMemories()).rejects.toThrow(/BRAIN_API_URL/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(everythingPrinted()).not.toContain(SERVICE);
    });
  });

  describe('redirect handling', () => {
    it('every request that carries the service key refuses redirects', async () => {
      vi.stubEnv('BRAIN_API_URL', 'http://127.0.0.1:54321');
      const file = join(home, 'memories.txt');
      writeFileSync(file, 'first memory\n');
      // PostgREST reads return rows; function calls return an object.
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).includes('/rest/v1/')
            ? String(url).includes('/contradictions?')
              ? [{ id: 'c1' }]
              : []
            : { success: true, status: 'compiled', findings: [] },
      }));

      process.argv = ['node', 'brain', 'import', file, '--delay', '0'];
      await importMemories();
      await captureSingleThought('hello');
      await wikiRefreshCommand(['some-slug']);
      await wikiRefreshCommand(['--all']);
      await wikiRejectCommand(['page-1', '--reason', 'wrong']);
      await wikiGetCommand(['some-slug']);
      await wikiListCommand([]);
      process.argv = ['node', 'brain', 'audit'];
      await auditCommand();
      process.argv = ['node', 'brain', 'audit', '--resolve', 'c1', '--decision', 'resolved'];
      await auditCommand();
      process.argv = ['node', 'brain', 'sync-vault', join(home, 'vault'), '--dry-run'];
      await syncVault();

      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(10);
      for (const [url, init] of fetchMock.mock.calls) {
        expect(init, String(url)).toMatchObject({ redirect: 'error' });
      }
    });
  });
});
