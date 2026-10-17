import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
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
});
