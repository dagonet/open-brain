import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../brain.js';
import {
  TaskSetUsageError,
  buildTaskSetBody,
  formatTaskSetLine,
  isMissingTaskFunction,
  parseTaskSetArgs,
  taskSetEcho,
} from '../task-set.js';

const BASE = 'http://127.0.0.1:54321';
const SERVICE = 'service-key-secret-value';
const ID = '11111111-1111-1111-1111-111111111111';

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    title: 'Write the thing',
    status: 'in_progress',
    priority: 2,
    created_at: '2026-10-01T08:00:00.000000+00:00',
    updated_at: '2026-10-17T12:30:00.123456+00:00',
    metadata: {},
    status_history: [{ status: 'open', at: '2026-10-01T08:00:00.000Z' }],
    ...over,
  };
}

describe('parseTaskSetArgs', () => {
  it('parses every flag in the space form', () => {
    expect(
      parseTaskSetArgs([ID, '--status', 'done', '--priority', '3', '--note', 'shipped', '--json']),
    ).toEqual({ id: ID, status: 'done', priority: 3, note: 'shipped', json: true });
  });

  it('parses the --flag=value form', () => {
    expect(parseTaskSetArgs([ID, '--status=blocked', '--priority=1', '--note=waiting'])).toEqual({
      id: ID,
      status: 'blocked',
      priority: 1,
      note: 'waiting',
      json: false,
    });
  });

  it('accepts the id after the flags (flag order does not matter)', () => {
    expect(parseTaskSetArgs(['--json', '--priority', '5', ID])).toEqual({
      id: ID,
      priority: 5,
      json: true,
    });
  });

  it('accepts upper-case hex and any 8-4-4-4-12 hex (no version bits required)', () => {
    const odd = 'ABCDEF01-2345-6789-ABCD-EF0123456789';
    expect(parseTaskSetArgs([odd, '--priority', '1']).id).toBe(odd);
    expect(parseTaskSetArgs(['00000000-0000-0000-0000-000000000000', '--note', 'x']).id).toBe(
      '00000000-0000-0000-0000-000000000000',
    );
  });

  it.each(['open', 'in_progress', 'blocked', 'done', 'cancelled'])('accepts status %s', (s) => {
    expect(parseTaskSetArgs([ID, '--status', s]).status).toBe(s);
  });

  it('keeps a note that starts with -- when given as --note=...', () => {
    expect(parseTaskSetArgs([ID, '--note=--force did not help']).note).toBe('--force did not help');
  });

  it('keeps a note with spaces, tabs and non-ASCII text untouched', () => {
    expect(parseTaskSetArgs([ID, '--note', '  a\tb  é ']).note).toBe('  a\tb  é ');
  });

  it('keeps a single-dash note value', () => {
    expect(parseTaskSetArgs([ID, '--note', '-1 retry']).note).toBe('-1 retry');
  });

  const bad: [string, string[], RegExp][] = [
    ['no id', ['--priority', '1'], /<id> is required/],
    ['nothing at all', [], /<id> is required/],
    ['no change flag', [ID], /at least one of --status, --priority or --note/],
    ['only --json', [ID, '--json'], /at least one of --status, --priority or --note/],
    ['id too short', ['1234', '--priority', '1'], /<id> must be a UUID/],
    [
      'id with non-hex',
      ['zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', '--priority', '1'],
      /<id> must be a UUID/,
    ],
    [
      'id without dashes',
      ['11111111111111111111111111111111', '--priority', '1'],
      /<id> must be a UUID/,
    ],
    ['id with braces', [`{${ID}}`, '--priority', '1'], /<id> must be a UUID/],
    ['id with a newline', [`${ID}\n`, '--priority', '1'], /<id> must be a UUID/],
    ['second positional', [ID, ID, '--priority', '1'], /unexpected argument/],
    ['unknown flag', [ID, '--bogus'], /unexpected argument: --bogus/],
    [
      '--project is not a flag here',
      [ID, '--project', 'p', '--priority', '1'],
      /unexpected argument: --project/,
    ],
    ['--title is not a flag', [ID, '--title', 'x'], /unexpected argument: --title/],
    ['single-dash flag', [ID, '-p', '1'], /unexpected argument: -p/],
    [
      'unknown status',
      [ID, '--status', 'wip'],
      /--status must be one of open, in_progress, blocked, done, cancelled/,
    ],
    ['status list', [ID, '--status', 'open,done'], /--status must be one of/],
    ['upper-case status', [ID, '--status', 'DONE'], /--status must be one of/],
    ['priority 0', [ID, '--priority', '0'], /--priority must be an integer from 1 to 5/],
    ['priority 6', [ID, '--priority', '6'], /--priority must be an integer from 1 to 5/],
    ['priority negative', [ID, '--priority', '-1'], /--priority must be an integer from 1 to 5/],
    ['priority fractional', [ID, '--priority', '1.5'], /--priority must be an integer from 1 to 5/],
    ['priority text', [ID, '--priority', 'high'], /--priority must be an integer from 1 to 5/],
    [
      'priority null (no clearing)',
      [ID, '--priority', 'null'],
      /--priority must be an integer from 1 to 5/,
    ],
    ['status missing value', [ID, '--status'], /--status requires a value/],
    ['status empty value', [ID, '--status='], /--status requires a value/],
    ['status value is a flag', [ID, '--status', '--json'], /--status requires a value/],
    ['note missing value', [ID, '--note'], /--note requires a value/],
    ['note empty value', [ID, '--note', ''], /--note requires a value/],
    ['note empty =value', [ID, '--note='], /--note requires a value/],
    ['blank note', [ID, '--note', '  \t '], /--note must not be blank/],
    [
      'note starting with -- in the space form',
      [ID, '--note', '--force'],
      /--note requires a value.*--note=<text>/,
    ],
    [
      'repeated --status',
      [ID, '--status', 'open', '--status', 'done'],
      /--status given more than once/,
    ],
    [
      'repeated --priority',
      [ID, '--priority=1', '--priority=2'],
      /--priority given more than once/,
    ],
    ['repeated --note', [ID, '--note', 'a', '--note', 'b'], /--note given more than once/],
    ['--json with a value', [ID, '--priority', '1', '--json=1'], /--json does not take a value/],
  ];
  it.each(bad)('%s throws a usage error', (_n, args, msg) => {
    expect(() => parseTaskSetArgs(args)).toThrow(TaskSetUsageError);
    expect(() => parseTaskSetArgs(args)).toThrow(msg);
  });
});

describe('buildTaskSetBody', () => {
  const base = { id: ID, json: false };

  it('sends only the keys that were given', () => {
    expect(buildTaskSetBody({ ...base, status: 'done' })).toEqual({
      p_id: ID,
      p_patch: {},
      p_status: 'done',
    });
    expect(buildTaskSetBody({ ...base, priority: 4 })).toEqual({
      p_id: ID,
      p_patch: { priority: 4 },
    });
    expect(buildTaskSetBody({ ...base, note: 'n' })).toEqual({
      p_id: ID,
      p_patch: {},
      p_note: 'n',
    });
  });

  it('combines all three', () => {
    expect(buildTaskSetBody({ ...base, status: 'blocked', priority: 1, note: 'why' })).toEqual({
      p_id: ID,
      p_patch: { priority: 1 },
      p_status: 'blocked',
      p_note: 'why',
    });
  });

  it('leaves out keys that were not given', () => {
    const body = buildTaskSetBody({ ...base, status: 'open' });
    expect(body).toStrictEqual({ p_id: ID, p_patch: {}, p_status: 'open' });
  });
});

describe('output helpers', () => {
  it('taskSetEcho is the compact echo', () => {
    expect(taskSetEcho(row() as never)).toEqual({
      id: ID,
      status: 'in_progress',
      priority: 2,
      updated_at: '2026-10-17T12:30:00.123456+00:00',
      history_len: 1,
    });
  });

  it('taskSetEcho: history_len is 0 without an array, priority stays null', () => {
    const echo = taskSetEcho(row({ status_history: null, priority: null }) as never);
    expect(echo.history_len).toBe(0);
    expect(echo.priority).toBeNull();
  });

  it('formatTaskSetLine matches the task list line style', () => {
    expect(formatTaskSetLine(row() as never)).toBe(
      [ID, 'in_progress', '2', '2026-10-17', 'no', 'Write the thing'].join('\t'),
    );
  });

  it('formatTaskSetLine: planned comes from metadata.plan, empty priority stays empty', () => {
    const plan = { owner: 'me', goal: 'g', next_step: 'n', done_check: 'd' };
    const line = formatTaskSetLine(row({ priority: null, metadata: { plan } }) as never);
    expect(line.split('\t')).toEqual([
      ID,
      'in_progress',
      '',
      '2026-10-17',
      'yes',
      'Write the thing',
    ]);
  });

  it('formatTaskSetLine tolerates a missing metadata column', () => {
    const r = row();
    delete r.metadata;
    expect(formatTaskSetLine(r as never).split('\t')[4]).toBe('no');
  });
});

describe('isMissingTaskFunction', () => {
  it('matches PGRST202', () => {
    expect(
      isMissingTaskFunction({ code: 'PGRST202', message: 'Could not find the function' }),
    ).toBe(true);
  });
  it('matches 42883 only when it names task_apply_update', () => {
    const msg = 'function public.task_apply_update(uuid) does not exist';
    expect(isMissingTaskFunction({ code: '42883', message: msg })).toBe(true);
    expect(
      isMissingTaskFunction({ code: '42883', message: 'function other() does not exist' }),
    ).toBe(false);
  });
  it('matches the text alone when it names the function', () => {
    expect(
      isMissingTaskFunction({ message: 'function public.task_apply_update() does not exist' }),
    ).toBe(true);
    expect(isMissingTaskFunction({ message: 'function other() does not exist' })).toBe(false);
  });
  it('does not match unrelated failures or non-objects', () => {
    expect(isMissingTaskFunction({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingTaskFunction(null)).toBe(false);
    expect(isMissingTaskFunction('x')).toBe(false);
    expect(isMissingTaskFunction({ code: 5 })).toBe(false);
  });
});

describe('brain task set', () => {
  const fetchMock = vi.fn();
  const origArgv = process.argv;
  let home: string;
  let stdout: string[];
  let stderr: string[];

  async function run(...args: string[]): Promise<number> {
    process.argv = ['node', 'brain', 'task', 'set', ...args];
    try {
      await main();
      return 0;
    } catch (err) {
      const m = /^exit:(\d+)$/.exec(err instanceof Error ? err.message : '');
      if (!m) throw err;
      return Number(m[1]);
    }
  }

  function respond(data: unknown, init: { ok?: boolean; status?: number } = {}): void {
    fetchMock.mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      headers: new Headers(),
      json: async () => data,
    });
  }

  function request(): { url: string; init: RequestInit & { headers: Record<string, string> } } {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    return { url: url as string, init };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    home = mkdtempSync(join(tmpdir(), 'brain-cli-task-set-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('BRAIN_API_URL', BASE);
    vi.stubEnv('BRAIN_API_KEY', '');
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
    vi.stubGlobal('fetch', fetchMock);
    respond([row()]);
    stdout = [];
    stderr = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void stdout.push(a.join(' ')));
    vi.spyOn(console, 'error').mockImplementation(
      (...a: unknown[]) => void stderr.push(a.join(' ')),
    );
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

  describe('request', () => {
    it('POSTs to the task_apply_update RPC with the service key and a JSON body', async () => {
      expect(await run(ID, '--status', 'done', '--priority', '1', '--note', 'shipped')).toBe(0);
      const { url, init } = request();
      expect(url).toBe(`${BASE}/rest/v1/rpc/task_apply_update`);
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      expect(init.headers).toMatchObject({
        apikey: SERVICE,
        Authorization: 'Bearer ' + SERVICE,
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(init.body as string)).toEqual({
        p_id: ID,
        p_patch: { priority: 1 },
        p_status: 'done',
        p_note: 'shipped',
      });
    });

    it('a note alone sends only p_id, an empty p_patch and p_note', async () => {
      expect(await run(ID, '--note=--keep this')).toBe(0);
      expect(JSON.parse(request().init.body as string)).toEqual({
        p_id: ID,
        p_patch: {},
        p_note: '--keep this',
      });
    });

    it('--note -h prints help and writes nothing; --note=-h sends the note', async () => {
      expect(await run(ID, '--note', '-h')).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await run(ID, '--note', '--help')).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await run(ID, '--note=-h')).toBe(0);
      expect(JSON.parse(request().init.body as string).p_note).toBe('-h');
    });

    it('does not read OPEN_BRAIN_DEFAULT_PROJECT or send a project', async () => {
      vi.stubEnv('OPEN_BRAIN_DEFAULT_PROJECT', 'from-env');
      expect(await run(ID, '--priority', '2')).toBe(0);
      expect(request().init.body as string).not.toMatch(/project|from-env/);
    });
  });

  describe('output', () => {
    it('prints one task-list style line', async () => {
      expect(await run(ID, '--status', 'in_progress')).toBe(0);
      expect(stdout).toEqual([
        [ID, 'in_progress', '2', '2026-10-17', 'no', 'Write the thing'].join('\t'),
      ]);
    });

    it('--json prints the compact echo only', async () => {
      respond([row({ status: 'done', status_history: [{}, {}, {}] })]);
      expect(await run(ID, '--status', 'done', '--json')).toBe(0);
      expect(stdout).toHaveLength(1);
      expect(JSON.parse(stdout[0])).toEqual({
        id: ID,
        status: 'done',
        priority: 2,
        updated_at: '2026-10-17T12:30:00.123456+00:00',
        history_len: 3,
      });
    });

    it('never prints the key', async () => {
      await run(ID, '--priority', '3');
      expect(stdout.join('\n') + stderr.join('\n')).not.toContain(SERVICE);
    });
  });

  describe('errors', () => {
    it('a task that is missing, deleted or cancelled (zero rows) exits 1 with "not found"', async () => {
      respond([]);
      expect(await run(ID, '--status', 'done')).toBe(1);
      const err = stderr.join('\n');
      expect(err).toMatch(/task not found/i);
      expect(err).toContain(ID);
      expect(stdout).toEqual([]);
    });

    it.each([
      [
        'PGRST202',
        { code: 'PGRST202', message: 'Could not find the function public.task_apply_update' },
        404,
      ],
      [
        '42883',
        { code: '42883', message: 'function public.task_apply_update(uuid) does not exist' },
        404,
      ],
    ])(
      'a missing function (%s) prints the migration 019 guidance and exits 1',
      async (_n, body, status) => {
        respond(body, { ok: false, status });
        expect(await run(ID, '--priority', '1')).toBe(1);
        const err = stderr.join('\n');
        expect(err).toMatch(/migration 019/);
        expect(err).toMatch(/supabase db push --remote/);
        expect(err).toMatch(/docs\/upgrading\.md/);
        expect(err).not.toContain(SERVICE);
      },
    );

    it('another server error uses describeFailure and exits 1', async () => {
      respond({ message: 'permission denied' }, { ok: false, status: 401 });
      expect(await run(ID, '--priority', '1')).toBe(1);
      const err = stderr.join('\n');
      expect(err).toMatch(/HTTP 401: permission denied/);
      expect(err).toMatch(/BRAIN_SERVICE_KEY/);
      expect(err).not.toContain(SERVICE);
    });

    it.each([
      ['an object', { message: 'nope' }],
      ['null', null],
      ['a string', 'ok'],
    ])('a 2xx body that is %s exits 1 with a clear message', async (_n, body) => {
      respond(body);
      expect(await run(ID, '--priority', '1')).toBe(1);
      const err = stderr.join('\n');
      expect(err).toMatch(/unexpected response from the server/);
      expect(err).not.toContain(SERVICE);
      expect(stdout).toEqual([]);
    });

    it('a usage error exits 1 before any request, with the command name', async () => {
      expect(await run(ID)).toBe(1);
      expect(stderr.join('\n')).toMatch(/brain task set: .*at least one of/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a missing service key exits 1 before any request', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', '');
      expect(await run(ID, '--priority', '1')).toBe(1);
      expect(stderr.join('\n')).toMatch(/service-role key/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('--help prints usage with the task set line and sends nothing', async () => {
      expect(await run('--help')).toBe(0);
      expect(stdout.join('\n')).toMatch(/brain task set <id>/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
