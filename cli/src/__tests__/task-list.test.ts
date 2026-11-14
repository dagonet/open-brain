import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../brain.js';
import {
  buildTaskListPath,
  isPlanned,
  parseContentRangeTotal,
  parseTaskListArgs,
  truncateCodePoints,
} from '../task-list.js';

const BASE = 'http://127.0.0.1:54321';
const SERVICE = 'service-key-secret-value';
const PLAN = { owner: 'me', goal: 'g', next_step: 'n', done_check: 'd' };

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Write the thing',
    status: 'open',
    priority: 2,
    created_at: '2026-10-01T08:00:00.000000+00:00',
    updated_at: '2026-10-17T12:30:00.123456+00:00',
    plan: null,
    ...over,
  };
}

describe('brain task list', () => {
  const fetchMock = vi.fn();
  const origArgv = process.argv;
  let home: string;
  let stdout: string[];
  let stderr: string[];

  async function run(...args: string[]): Promise<number> {
    process.argv = ['node', 'brain', 'task', ...args];
    try {
      await main();
      return 0;
    } catch (err) {
      const m = /^exit:(\d+)$/.exec(err instanceof Error ? err.message : '');
      if (!m) throw err;
      return Number(m[1]);
    }
  }

  function respond(
    data: unknown,
    init: { ok?: boolean; status?: number; contentRange?: string } = {},
  ): void {
    fetchMock.mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      headers: new Headers(init.contentRange ? { 'content-range': init.contentRange } : {}),
      json: async () => data,
    });
  }

  /** Query of the one fetch call as a URLSearchParams, plus the request init. */
  function request(): { url: URL; init: RequestInit & { headers: Record<string, string> } } {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    return { url: new URL(url as string), init };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    home = mkdtempSync(join(tmpdir(), 'brain-cli-task-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('BRAIN_API_URL', BASE);
    vi.stubEnv('BRAIN_API_KEY', '');
    vi.stubEnv('BRAIN_SERVICE_KEY', SERVICE);
    vi.stubEnv('OPEN_BRAIN_DEFAULT_PROJECT', '');
    vi.stubGlobal('fetch', fetchMock);
    respond([]);
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
    it('defaults: not deleted, newest first, limit 50, compact select, GET with the service key', async () => {
      expect(await run('list')).toBe(0);
      const { url, init } = request();
      expect(url.origin + url.pathname).toBe(`${BASE}/rest/v1/tasks`);
      const q = url.searchParams;
      expect(q.get('select')).toBe(
        'id,title,status,priority,created_at,updated_at,plan:metadata->plan',
      );
      expect(q.get('deleted_at')).toBe('is.null');
      expect(q.get('order')).toBe('created_at.desc');
      expect(q.get('limit')).toBe('50');
      expect(q.has('project')).toBe(false);
      expect(q.has('status')).toBe(false);
      expect(q.has('updated_at')).toBe(false);
      expect(q.has('priority')).toBe(false);
      expect(init.method ?? 'GET').toBe('GET');
      expect(init.headers.Authorization).toBe(`Bearer ${SERVICE}`);
      expect(init.headers.Prefer).toBeUndefined();
    });

    it('--project, --status list, --limit and --sort priority', async () => {
      await run(
        'list',
        '--project',
        'my repo',
        '--status',
        'open,blocked',
        '--sort',
        'priority',
        '--limit',
        '5',
      );
      const q = request().url.searchParams;
      expect(q.get('project')).toBe('eq.my repo');
      expect(q.get('status')).toBe('in.(open,blocked)');
      expect(q.get('order')).toBe('priority.asc.nullslast,updated_at.asc');
      expect(q.get('limit')).toBe('5');
    });

    it('--flag=value form works', async () => {
      await run('list', '--status=done', '--limit=3', '--sort=created', '--project=p');
      const q = request().url.searchParams;
      expect(q.get('status')).toBe('in.(done)');
      expect(q.get('limit')).toBe('3');
      expect(q.get('project')).toBe('eq.p');
    });

    it('--priority-missing filters priority is null', async () => {
      await run('list', '--priority-missing');
      expect(request().url.searchParams.get('priority')).toBe('is.null');
    });

    it('--stale-days sends updated_at < now - N days', async () => {
      const now = Date.parse('2026-11-14T12:00:00.000Z');
      vi.useFakeTimers({ now, toFake: ['Date'] });
      try {
        await run('list', '--stale-days', '14');
      } finally {
        vi.useRealTimers();
      }
      expect(request().url.searchParams.get('updated_at')).toBe('lt.2026-10-31T12:00:00.000Z');
    });

    it('falls back to OPEN_BRAIN_DEFAULT_PROJECT, and --project wins over it', async () => {
      vi.stubEnv('OPEN_BRAIN_DEFAULT_PROJECT', 'from-env');
      await run('list');
      expect(request().url.searchParams.get('project')).toBe('eq.from-env');

      fetchMock.mockClear();
      await run('list', '--project', 'explicit');
      expect(request().url.searchParams.get('project')).toBe('eq.explicit');
    });

    it('encodes a project name that carries query characters', async () => {
      await run('list', '--project', 'a&b=c');
      const { url } = request();
      expect(url.searchParams.get('project')).toBe('eq.a&b=c');
      expect(url.searchParams.getAll('b')).toEqual([]);
    });

    it('combines every filter', () => {
      const opts = parseTaskListArgs([
        '--status',
        'open,in_progress',
        '--stale-days',
        '7',
        '--priority-missing',
        '--sort',
        'priority',
        '--limit',
        '10',
      ]);
      const path = buildTaskListPath(opts, 'proj', Date.parse('2026-11-14T00:00:00.000Z'));
      const q = new URL('http://x/' + path).searchParams;
      expect([...q.keys()].sort()).toEqual(
        [
          'deleted_at',
          'limit',
          'order',
          'priority',
          'project',
          'select',
          'status',
          'updated_at',
        ].sort(),
      );
      expect(q.get('updated_at')).toBe('lt.2026-11-07T00:00:00.000Z');
    });
  });

  describe('output', () => {
    it('prints one tab-separated line per task', async () => {
      respond([
        row({ plan: PLAN }),
        row({
          id: '22222222-2222-2222-2222-222222222222',
          status: 'in_progress',
          priority: null,
          title: 'Second',
          updated_at: '2026-09-02T00:00:00Z',
        }),
      ]);
      await run('list');
      expect(stdout).toEqual([
        '11111111-1111-1111-1111-111111111111\topen\t2\t2026-10-17\tyes\tWrite the thing',
        '22222222-2222-2222-2222-222222222222\tin_progress\t\t2026-09-02\tno\tSecond',
      ]);
    });

    it('cuts the title to 100 code points with an ellipsis and flattens tabs and newlines', async () => {
      const long = '😀'.repeat(101);
      respond([row({ title: long }), row({ title: 'a\tb\nc' })]);
      await run('list');
      const t1 = stdout[0].split('\t')[5];
      expect(Array.from(t1)).toHaveLength(101);
      expect(t1.endsWith('…')).toBe(true);
      expect(stdout[1].split('\t')).toHaveLength(6);
      expect(stdout[1].split('\t')[5]).toBe('a b c');
    });

    it('prints nothing for no rows', async () => {
      await run('list');
      expect(stdout).toEqual([]);
    });

    it('--json prints a compact array', async () => {
      respond([row({ plan: PLAN, title: 'x'.repeat(120) }), row({ plan: { owner: 'me' } })]);
      await run('list', '--json');
      expect(stdout).toHaveLength(1);
      const parsed = JSON.parse(stdout[0]) as Record<string, unknown>[];
      expect(Object.keys(parsed[0]).sort()).toEqual(
        ['created_at', 'id', 'planned', 'priority', 'status', 'title', 'updated_at'].sort(),
      );
      expect(parsed[0].planned).toBe(true);
      expect(parsed[0].title).toBe('x'.repeat(100) + '…');
      expect(parsed[1].planned).toBe(false);
      expect(parsed[1].updated_at).toBe('2026-10-17T12:30:00.123456+00:00');
    });

    it('--json prints [] for no rows', async () => {
      await run('list', '--json');
      expect(stdout).toEqual(['[]']);
    });
  });

  describe('--count', () => {
    it('prints the total from Content-Range, not capped by the limit', async () => {
      respond([{ id: 'a' }], { status: 206, contentRange: '0-0/137' });
      await run('list', '--count', '--status', 'open', '--limit', '5', '--sort', 'priority');
      expect(stdout).toEqual(['137']);
      const { url, init } = request();
      const q = url.searchParams;
      expect(init.headers.Prefer).toBe('count=exact');
      expect(init.method ?? 'GET').toBe('GET');
      expect(q.get('select')).toBe('id');
      expect(q.get('limit')).toBe('1');
      expect(q.has('order')).toBe(false);
      expect(q.get('status')).toBe('in.(open)');
      expect(q.get('deleted_at')).toBe('is.null');
    });

    it('prints 0 for an empty result', async () => {
      respond([], { contentRange: '*/0' });
      await run('list', '--count', '--json');
      expect(stdout).toEqual(['0']);
    });

    it('fails when the server sends no total', async () => {
      respond([]);
      expect(await run('list', '--count')).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr.join('\n')).toMatch(/row count/);
    });
  });

  describe('errors', () => {
    const bad: [string, string[], RegExp][] = [
      [
        'unknown status',
        ['--status', 'open,wip'],
        /unknown status "wip".*open, in_progress, blocked, done/,
      ],
      ['cancelled is not accepted', ['--status', 'cancelled'], /unknown status "cancelled"/],
      ['empty status item', ['--status', 'open,'], /unknown status ""/],
      [
        'non-numeric stale-days',
        ['--stale-days', 'abc'],
        /--stale-days must be an integer from 1 to 36500/,
      ],
      ['stale-days 0', ['--stale-days', '0'], /--stale-days must be/],
      ['stale-days too large', ['--stale-days', '36501'], /--stale-days must be/],
      ['fractional stale-days', ['--stale-days', '1.5'], /--stale-days must be/],
      ['negative limit', ['--limit', '-1'], /--limit/],
      ['limit 0', ['--limit', '0'], /--limit must be an integer >= 1/],
      ['bad sort', ['--sort', 'title'], /--sort must be/],
      ['missing value', ['--limit'], /--limit requires a value/],
      ['flag as value', ['--project', '--json'], /--project requires a value/],
      ['unknown flag', ['--bogus'], /unexpected argument: --bogus/],
      ['stray word', ['extra'], /unexpected argument: extra/],
      ['boolean flag with value', ['--count=1'], /does not take a value/],
    ];
    it.each(bad)('%s exits 1 with a message and sends nothing', async (_n, args, msg) => {
      expect(await run('list', ...args)).toBe(1);
      expect(stderr.join('\n')).toMatch(msg);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('unknown and missing subcommands, including task set, exit 1', async () => {
      expect(await run('set')).toBe(1);
      expect(stderr.join('\n')).toMatch(/unknown task subcommand: set/);
      stderr.length = 0;
      expect(await run()).toBe(1);
      expect(stderr.join('\n')).toMatch(/unknown task subcommand: \(none\)/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('--help prints usage with the task list line and sends nothing', async () => {
      expect(await run('list', '--help')).toBe(0);
      expect(stdout.join('\n')).toMatch(/brain task list/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a server error exits 1 with the status and never prints the key', async () => {
      respond({ message: 'permission denied' }, { ok: false, status: 401 });
      expect(await run('list')).toBe(1);
      const err = stderr.join('\n');
      expect(err).toMatch(/HTTP 401: permission denied/);
      expect(err).not.toContain(SERVICE);
      expect(stdout.join('\n')).not.toContain(SERVICE);
    });

    it('a missing service key exits 1 before any request', async () => {
      vi.stubEnv('BRAIN_SERVICE_KEY', '');
      expect(await run('list')).toBe(1);
      expect(stderr.join('\n')).toMatch(/service-role key/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

describe('task-list helpers', () => {
  it('isPlanned mirrors the MCP rule', () => {
    expect(isPlanned(PLAN)).toBe(true);
    expect(isPlanned({ ...PLAN, goal: '   ' })).toBe(false);
    expect(isPlanned({ ...PLAN, next_step: 1 })).toBe(false);
    expect(isPlanned({ owner: 'o', goal: 'g', next_step: 'n' })).toBe(false);
    expect(isPlanned(null)).toBe(false);
    expect(isPlanned([PLAN])).toBe(false);
    expect(isPlanned('plan')).toBe(false);
  });

  it('truncateCodePoints cuts by code point and only marks a cut', () => {
    expect(truncateCodePoints('abc', 3)).toBe('abc');
    expect(truncateCodePoints('abcd', 3)).toBe('abc…');
    expect(truncateCodePoints('😀😀😀', 2)).toBe('😀😀…');
  });

  it('parseContentRangeTotal reads the total', () => {
    expect(parseContentRangeTotal('0-49/1234')).toBe(1234);
    expect(parseContentRangeTotal('*/0')).toBe(0);
    expect(parseContentRangeTotal('0-9/*')).toBeNull();
    expect(parseContentRangeTotal(null)).toBeNull();
  });
});
