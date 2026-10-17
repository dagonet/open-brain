import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, CLI_VERSION } from '../brain.js';

const PKG_VERSION = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf-8'),
  ) as { version: string }
).version;

describe('brain top-level flags (issue #96)', () => {
  const fetchMock = vi.fn();
  const origArgv = process.argv;

  let stdout: string[];
  let stderr: string[];

  /** Run main() as `brain <args...>`; resolves to the exit code (0 when main returns normally). */
  async function run(...args: string[]): Promise<number> {
    process.argv = ['node', 'brain', ...args];
    try {
      await main();
      return 0;
    } catch (err) {
      const match = /^exit:(\d+)$/.exec(err instanceof Error ? err.message : '');
      if (!match) throw err;
      return Number(match[1]);
    }
  }

  beforeEach(() => {
    vi.resetAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        thought: { thought_type: 'note', people: [], topics: [], action_items: [] },
        is_duplicate: false,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('BRAIN_API_URL', 'https://proj.supabase.co/functions/v1/capture-thought');
    vi.stubEnv('BRAIN_SERVICE_KEY', 'service-key-value');
    stdout = [];
    stderr = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => {
      stdout.push(a.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...a) => {
      stderr.push(a.join(' '));
    });
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

  it('reads CLI_VERSION from cli/package.json', () => {
    expect(CLI_VERSION).toBe(PKG_VERSION);
  });

  it.each(['--version', '-V'])(
    '%s prints the package version, exits 0, captures nothing',
    async (flag) => {
      expect(await run(flag)).toBe(0);

      expect(stdout).toEqual([PKG_VERSION]);
      expect(stderr).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['help', '--help', '-h'])(
    '%s prints usage to stdout, exits 0, captures nothing',
    async (arg) => {
      expect(await run(arg)).toBe(0);

      expect(stdout.join('\n')).toContain('Usage:');
      expect(stderr).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['--bogus', '-x', '-', '--project'])(
    'unknown option %s is an error on stderr and captures nothing',
    async (flag) => {
      const code = await run(flag);

      expect(code).toBe(1);
      expect(stderr.join('\n')).toContain(`unknown option: ${flag}`);
      expect(stdout).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('an unknown option followed by text still captures nothing', async () => {
    expect(await run('--bogus', 'some text')).toBe(1);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('`--` lets text that starts with a dash be captured', async () => {
    expect(await run('--', '-x is a flag')).toBe(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ text: '-x is a flag', source: 'cli' });
  });

  it('`--` still honours --project', async () => {
    expect(await run('--', '--version', '--project', 'p1')).toBe(0);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ text: '--version', project: 'p1' });
  });

  it('`--` with no text is a usage error and captures nothing', async () => {
    expect(await run('--')).toBe(1);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('`-- help` captures the word help', async () => {
    expect(await run('--', 'help')).toBe(0);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ text: 'help' });
  });

  it('help is reserved only as the sole argument: a quoted sentence starting with help is captured', async () => {
    expect(await run('help me remember X')).toBe(0);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ text: 'help me remember X' });
  });

  it('help with further arguments is not the help command: it is capture text', async () => {
    expect(await run('help', '--project', 'p1')).toBe(0);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ text: 'help', project: 'p1' });
  });

  it('unquoted `help me remember X` is a usage error (capture takes one text argument), nothing is captured', async () => {
    expect(await run('help', 'me', 'remember', 'X')).toBe(1);

    expect(stderr.join('\n')).toContain('unexpected argument: me');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('plain capture and --project are unchanged', async () => {
    expect(await run('a normal thought', '--project', 'p1')).toBe(0);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ text: 'a normal thought', project: 'p1' });
  });

  it('no arguments prints usage to stderr, exits 1, captures nothing', async () => {
    expect(await run()).toBe(1);

    expect(stderr.join('\n')).toContain('Usage:');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unknown option error hints at `--` for text that starts with a dash', async () => {
    expect(await run('-x')).toBe(1);

    expect(stderr.join('\n')).toContain('put it after --, e.g. brain -- "- buy milk"');
  });

  it('--project before the text says it must come after the text', async () => {
    expect(await run('--project', 'p1', 'some text')).toBe(1);

    expect(stderr.join('\n')).toContain('--project must come after the text');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('subcommands', () => {
    let dir: string;
    let origCwd: string;

    beforeEach(() => {
      origCwd = process.cwd();
      dir = mkdtempSync(join(tmpdir(), 'brain-flags-'));
    });

    afterEach(() => {
      process.chdir(origCwd);
      rmSync(dir, { recursive: true, force: true });
    });

    it.each([['sync-vault'], ['import'], ['audit']])(
      '%s --help and -h print usage on stdout, exit 0, send nothing and write nothing',
      async (sub) => {
        for (const flag of ['--help', '-h']) {
          stdout = [];
          expect(await run(sub, flag)).toBe(0);
          expect(stdout.join('\n')).toContain('Usage:');
        }

        expect(stderr).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(readdirSync(dir)).toEqual([]);
      },
    );

    it.each([['--help'], ['-h']])('sync-vault <path> %s writes nothing', async (flag) => {
      const vault = join(dir, 'vault');

      expect(await run('sync-vault', vault, flag)).toBe(0);

      expect(existsSync(vault)).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ['wiki', '--help'],
      ['wiki', '-h'],
      ['wiki', 'get', '--help'],
      ['wiki', 'list', '-h'],
      ['wiki', 'refresh', '--help'],
      ['wiki', 'reject', '--help'],
    ])('%s %s %s prints usage, exits 0, sends nothing', async (...args) => {
      expect(await run(...args)).toBe(0);

      expect(stdout.join('\n')).toContain('Usage:');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sync-vault rejects an unknown dash argument where the path goes and writes nothing', async () => {
      process.chdir(dir);

      expect(await run('sync-vault', '--bogus')).toBe(1);

      expect(stderr.join('\n')).toContain('unknown option: --bogus');
      expect(existsSync(join(dir, '--bogus'))).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('import rejects an unknown dash argument where the file goes and sends nothing', async () => {
      expect(await run('import', '--bogus')).toBe(1);

      expect(stderr.join('\n')).toContain('unknown option: --bogus');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('import ./-weird-path still works', async () => {
      writeFileSync(join(dir, '-weird-path'), 'first memory\nsecond memory\n');
      process.chdir(dir);

      expect(await run('import', './-weird-path', '--dry-run')).toBe(0);

      expect(stdout.join('\n')).toContain('Found 2 memories in ./-weird-path');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sync-vault ./-weird-vault still reaches the server', async () => {
      process.chdir(dir);
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

      await run('sync-vault', './-weird-vault', '--dry-run');

      expect(stderr.join('\n')).not.toContain('unknown option');
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
