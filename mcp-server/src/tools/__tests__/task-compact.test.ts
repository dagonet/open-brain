import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { taskList, definition as listDef } from '../task-list.js';
import { taskGet, definition as getDef, type TaskGetParams } from '../task-get.js';
import { taskUpdate, definition as updateDef, type TaskUpdateParams } from '../task-update.js';
import { createMockSupabase, createMultiQueryMockSupabase } from './helpers.js';

type Mocks = Record<string, ReturnType<typeof vi.fn>>;
const mocks = (x: unknown) => x as Mocks;

const NOW = new Date('2026-06-15T12:00:00.000Z');
const UUID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  delete process.env.OPEN_BRAIN_DEFAULT_PROJECT;
});
afterEach(() => {
  vi.useRealTimers();
});

const fullPlan = { owner: 'a', goal: 'b', next_step: 'c', done_check: 'd' };

function row(over: Record<string, unknown> = {}) {
  return {
    id: UUID,
    title: 'T',
    status: 'open',
    status_history: [],
    project: null,
    description: null,
    priority: null,
    linked_thought_ids: [],
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    deleted_at: null,
    ...over,
  };
}

describe('task_list', () => {
  it('baseline: {} and today params keep the exact builder calls and answer', async () => {
    for (const raw of [{}, { status: 'open', priority: 2, limit: 10, project: 'p' }]) {
      const params = z.object(listDef.schema).parse(raw);
      const mock = createMockSupabase();
      const data = [row()];
      mock.resolvesWith(data);
      const out = await taskList(mock.client, params);
      const m = mocks(mock.client);
      expect(out).toBe(JSON.stringify(data));
      expect(m.select).toHaveBeenCalledExactlyOnceWith('*');
      expect(m.is).toHaveBeenCalledExactlyOnceWith('deleted_at', null);
      expect(m.order).toHaveBeenCalledExactlyOnceWith('created_at', { ascending: false });
      expect(m.limit).toHaveBeenCalledExactlyOnceWith(params.limit);
      const expectedEq =
        'status' in raw
          ? [
              ['project', 'p'],
              ['status', 'open'],
              ['priority', 2],
            ]
          : [];
      expect(m.eq.mock.calls).toEqual(expectedEq);
      expect(m.in).not.toHaveBeenCalled();
      expect(m.lt).not.toHaveBeenCalled();
    }
    const params = z.object(listDef.schema).parse({});
    expect(params).toEqual({ limit: 50 });
  });

  it('statuses maps to in()', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);
    await taskList(mock.client, { statuses: ['open', 'blocked'] });
    expect(mocks(mock.client).in).toHaveBeenCalledWith('status', ['open', 'blocked']);
  });

  it('rejects statuses with status, and priority with priority_missing', async () => {
    const mock = createMockSupabase();
    const a = JSON.parse(await taskList(mock.client, { status: 'open', statuses: ['done'] }));
    const b = JSON.parse(await taskList(mock.client, { priority: 1, priority_missing: true }));
    expect(a.error).toBeTypeOf('string');
    expect(b.error).toBeTypeOf('string');
    expect(mocks(mock.client).from).not.toHaveBeenCalled();
  });

  it('schema rejects empty statuses and unknown values', () => {
    const schema = z.object(listDef.schema);
    expect(schema.safeParse({ statuses: [] }).success).toBe(false);
    expect(schema.safeParse({ statuses: ['nope'] }).success).toBe(false);
    expect(schema.safeParse({ statuses: ['cancelled'] }).success).toBe(false);
    expect(schema.safeParse({ stale_days: 0 }).success).toBe(false);
    expect(schema.safeParse({ stale_days: 36501 }).success).toBe(false);
    expect(schema.safeParse({ stale_days: 36500 }).success).toBe(true);
    expect(schema.safeParse({ sort: 'x' }).success).toBe(false);
  });

  it('stale_days maps to lt(updated_at, cutoff)', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);
    await taskList(mock.client, { stale_days: 14 });
    expect(mocks(mock.client).lt).toHaveBeenCalledWith('updated_at', '2026-06-01T12:00:00.000Z');
  });

  it('priority_missing maps to is(priority, null)', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);
    await taskList(mock.client, { priority_missing: true });
    expect(mocks(mock.client).is).toHaveBeenCalledWith('priority', null);
  });

  it("sort 'priority' orders by priority then updated_at; 'created' is today's order", async () => {
    const a = createMockSupabase();
    a.resolvesWith([]);
    await taskList(a.client, { sort: 'priority', limit: 5 });
    expect(mocks(a.client).order.mock.calls).toEqual([
      ['priority', { ascending: true, nullsFirst: false }],
      ['updated_at', { ascending: true }],
    ]);
    expect(mocks(a.client).limit).toHaveBeenCalledWith(5);

    const b = createMockSupabase();
    b.resolvesWith([]);
    await taskList(b.client, { sort: 'created' });
    expect(mocks(b.client).order.mock.calls).toEqual([['created_at', { ascending: false }]]);
  });

  it('compact selects narrow columns and maps rows', async () => {
    const long = '😀'.repeat(120);
    const mock = createMockSupabase();
    mock.resolvesWith([
      {
        id: 'a',
        title: long,
        status: 'open',
        priority: 1,
        created_at: 'c',
        updated_at: 'u',
        plan: fullPlan,
      },
      { id: 'b', title: 'x'.repeat(100), status: 'done', priority: null, plan: null },
    ]);
    const out = JSON.parse(await taskList(mock.client, { compact: true }));
    expect(mocks(mock.client).select).toHaveBeenCalledWith(
      'id,title,status,priority,created_at,updated_at,plan:metadata->plan',
    );
    expect(out[0]).toEqual({
      id: 'a',
      title: '😀'.repeat(100) + '…',
      status: 'open',
      priority: 1,
      created_at: 'c',
      updated_at: 'u',
      planned: true,
      plan_shape: 'object',
    });
    expect(Object.keys(out[0]).slice(-2)).toEqual(['planned', 'plan_shape']);
    expect(Array.from(out[0].title)).toHaveLength(101);
    expect(out[1].title).toBe('x'.repeat(100));
    expect(out[1].planned).toBe(false);
    expect('plan' in out[0]).toBe(false);
  });

  it('planned needs an object with four non-blank strings', async () => {
    const plans = [
      { ...fullPlan, goal: '   ' },
      { owner: 'a', goal: 'b', next_step: 'c' },
      { ...fullPlan, owner: 5 },
      'plan',
      ['x'],
      null,
    ];
    const mock = createMockSupabase();
    mock.resolvesWith(plans.map((plan, i) => ({ id: String(i), title: 't', plan })));
    const out = JSON.parse(await taskList(mock.client, { compact: true }));
    expect(out.map((r: { planned: boolean }) => r.planned)).toEqual(plans.map(() => false));
  });

  it('plan_shape tells object, text, none and other apart; a text plan is not planned', async () => {
    const plans: unknown[] = [fullPlan, 'free text plan', null, ['x'], 5, true];
    const mock = createMockSupabase();
    mock.resolvesWith(plans.map((plan, i) => ({ id: String(i), title: 't', plan })));
    const out = JSON.parse(await taskList(mock.client, { compact: true }));
    expect(out.map((r: { plan_shape: string }) => r.plan_shape)).toEqual([
      'object',
      'text',
      'none',
      'other',
      'other',
      'other',
    ]);
    expect(out[1].planned).toBe(false);
    const absent = createMockSupabase();
    absent.resolvesWith([{ id: 'z', title: 't' }]);
    const out2 = JSON.parse(await taskList(absent.client, { compact: true }));
    expect(out2[0].plan_shape).toBe('none');
  });

  it('non-compact keeps select(*) with the new filters', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([row()]);
    await taskList(mock.client, { stale_days: 1 });
    expect(mocks(mock.client).select).toHaveBeenCalledExactlyOnceWith('*');
  });
});

describe('task_get', () => {
  it('baseline: unchanged answer and builder calls', async () => {
    const params = z.object(getDef.schema).parse({ id: UUID }) as unknown as TaskGetParams;
    expect(params).toEqual({ id: UUID });
    const mock = createMockSupabase();
    const data = row({ description: 'd'.repeat(500), metadata: { plan: fullPlan } });
    mock.resolvesWith(data);
    const out = await taskGet(mock.client, params);
    const m = mocks(mock.client);
    expect(out).toBe(JSON.stringify(data));
    expect(m.select).toHaveBeenCalledExactlyOnceWith('*');
    expect(m.eq).toHaveBeenCalledExactlyOnceWith('id', UUID);
    expect(m.is).toHaveBeenCalledExactlyOnceWith('deleted_at', null);
    expect(m.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('compact returns row, cut description, plan and history_len', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(
      row({
        title: 'T',
        description: '€'.repeat(400),
        metadata: { plan: fullPlan, big: 'x' },
        status_history: [1, 2, 3],
      }),
    );
    const out = JSON.parse(await taskGet(mock.client, { id: UUID, compact: true }));
    expect(Object.keys(out)).toEqual([
      'id',
      'title',
      'status',
      'priority',
      'created_at',
      'updated_at',
      'planned',
      'plan_shape',
      'description',
      'plan',
      'history_len',
    ]);
    expect(out).toEqual({
      id: UUID,
      title: 'T',
      status: 'open',
      priority: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      planned: true,
      plan_shape: 'object',
      description: '€'.repeat(300) + '…',
      plan: fullPlan,
      history_len: 3,
    });
  });

  it('compact honours description_chars, null description, null metadata, bad history', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(row({ description: null, metadata: null, status_history: null }));
    const out = JSON.parse(
      await taskGet(mock.client, { id: UUID, compact: true, description_chars: 0 }),
    );
    expect(out.description).toBeNull();
    expect(out.plan).toBeNull();
    expect(out.planned).toBe(false);
    expect(out.history_len).toBe(0);

    const mock2 = createMockSupabase();
    mock2.resolvesWith(row({ description: 'abcdef' }));
    const out2 = JSON.parse(
      await taskGet(mock2.client, { id: UUID, compact: true, description_chars: 3 }),
    );
    expect(out2.description).toBe('abc…');
  });

  it('compact plan_shape tells object, text, none and other apart', async () => {
    const metas: Array<Record<string, unknown> | null> = [
      { plan: fullPlan },
      { plan: 'free text plan' },
      {},
      { plan: null },
      null,
      { plan: ['x'] },
      { plan: 5 },
      { plan: false },
    ];
    const shapes: string[] = [];
    for (const metadata of metas) {
      const mock = createMockSupabase();
      mock.resolvesWith(row({ metadata }));
      const out = JSON.parse(await taskGet(mock.client, { id: UUID, compact: true }));
      shapes.push(out.plan_shape);
      if (out.plan_shape === 'text') {
        expect(out.planned).toBe(false);
        expect(out.plan).toBe('free text plan');
      }
    }
    expect(shapes).toEqual(['object', 'text', 'none', 'none', 'none', 'other', 'other', 'other']);
  });

  it('descriptions warn about text plans', () => {
    expect(updateDef.description).toContain(
      "metadata_merge replaces a key whole: if metadata.plan is text (plan_shape 'text' in compact rows), copy that text to `plan_text` in the same metadata_merge call, or it is lost.",
    );
    expect(listDef.description).toContain('plan_shape');
    expect(getDef.description).toContain('plan_shape');
  });

  it('schema bounds description_chars to 0..2000', () => {
    const schema = z.object(getDef.schema);
    expect(schema.safeParse({ id: UUID, description_chars: 2001 }).success).toBe(false);
    expect(schema.safeParse({ id: UUID, description_chars: 0 }).success).toBe(false);
    expect(schema.safeParse({ id: UUID, description_chars: 2000 }).success).toBe(true);
  });

  it('compact still reports not found', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null);
    const out = JSON.parse(await taskGet(mock.client, { id: UUID, compact: true }));
    expect(out).toEqual({ error: 'not found' });
  });
});

describe('task_update', () => {
  type RpcResult = { data: unknown; error?: { message: string; code?: string } | null };

  /** A client whose rpc resolves with `result`; from() answers the blank-title read. */
  function setup(result: RpcResult, titleRead: unknown = row()) {
    const fromChain = createMultiQueryMockSupabase([{ data: titleRead }]);
    const rpc = vi.fn().mockResolvedValue({ error: null, ...result });
    const client = { from: fromChain.client.from, rpc } as unknown as SupabaseClient;
    return { client, rpc, chains: fromChain.chains };
  }

  it('baseline: status change with note sends only the pre-114 arguments', async () => {
    const params = z.object(updateDef.schema).parse({
      id: UUID,
      status: 'done',
      note: 'ok',
    }) as unknown as TaskUpdateParams;
    expect(params).toEqual({ id: UUID, status: 'done', note: 'ok' });
    const written = row({ status: 'done' });
    const { client, rpc } = setup({ data: [written] });
    const out = await taskUpdate(client, params);
    expect(out).toBe(JSON.stringify(written));
    expect(rpc).toHaveBeenCalledExactlyOnceWith('task_apply_update', {
      p_id: UUID,
      p_patch: {},
      p_status: 'done',
      p_note: 'ok',
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('plain fields go in p_patch only; undefined keys are absent', async () => {
    const { client, rpc } = setup({ data: [row({ title: 'N' })] });
    await taskUpdate(client, { id: UUID, title: 'N', priority: 2, linked_thought_ids: [UUID] });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('task_apply_update', {
      p_id: UUID,
      p_patch: { title: 'N', priority: 2, linked_thought_ids: [UUID] },
    });
  });

  it('metadata goes in p_patch, metadata_merge in p_metadata_merge', async () => {
    const { client, rpc } = setup({ data: [row()] });
    await taskUpdate(client, { id: UUID, metadata: { a: 1 } });
    await taskUpdate(client, { id: UUID, metadata_merge: { drop: null, plan: fullPlan } });
    expect(rpc.mock.calls).toEqual([
      ['task_apply_update', { p_id: UUID, p_patch: { metadata: { a: 1 } } }],
      [
        'task_apply_update',
        { p_id: UUID, p_patch: {}, p_metadata_merge: { drop: null, plan: fullPlan } },
      ],
    ]);
  });

  it('note, status and merge are passed through untouched (the database decides entries)', async () => {
    const { client, rpc } = setup({ data: [row()] });
    await taskUpdate(client, { id: UUID, status: 'cancelled', note: '', metadata_merge: { b: 2 } });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('task_apply_update', {
      p_id: UUID,
      p_patch: {},
      p_metadata_merge: { b: 2 },
      p_status: 'cancelled',
      p_note: '',
    });
  });

  it('a bare {id} still calls the function, which returns the row without writing', async () => {
    const current = row();
    const { client, rpc } = setup({ data: [current] });
    const out = await taskUpdate(client, { id: UUID });
    expect(out).toBe(JSON.stringify(current));
    expect(rpc).toHaveBeenCalledExactlyOnceWith('task_apply_update', { p_id: UUID, p_patch: {} });
  });

  it('echo compact returns the small shape from the returned row', async () => {
    const written = row({ status: 'done', priority: 3, status_history: [1, 2], title: 'big' });
    const { client } = setup({ data: [written] });
    const out = JSON.parse(await taskUpdate(client, { id: UUID, status: 'done', echo: 'compact' }));
    expect(out).toEqual({
      id: UUID,
      status: 'done',
      priority: 3,
      updated_at: '2026-01-02T00:00:00Z',
      history_len: 2,
    });
    expect(Object.keys(out)).toEqual(['id', 'status', 'priority', 'updated_at', 'history_len']);
  });

  it("echo 'full' equals the default answer", async () => {
    const written = row({ title: 'N' });
    const { client } = setup({ data: [written] });
    const out = await taskUpdate(client, { id: UUID, title: 'N', echo: 'full' });
    expect(out).toBe(JSON.stringify(written));
  });

  it('no row back means not found (missing or already deleted task)', async () => {
    for (const data of [[], null]) {
      const { client } = setup({ data });
      expect(JSON.parse(await taskUpdate(client, { id: UUID, note: 'n' }))).toEqual({
        error: 'not found',
      });
    }
  });

  it('other errors keep their message', async () => {
    const { client } = setup({ data: null, error: { message: 'boom', code: '500' } });
    expect(JSON.parse(await taskUpdate(client, { id: UUID, note: 'n' }))).toEqual({
      error: 'boom',
    });
  });

  it('a missing function is a hard error that names migration 019, with no fallback', async () => {
    for (const error of [
      { code: 'PGRST202', message: 'Could not find the function public.task_apply_update' },
      { code: '42883', message: 'function public.task_apply_update(uuid) does not exist' },
      { message: 'function public.task_apply_update does not exist' },
    ]) {
      const { client } = setup({ data: null, error });
      const out = JSON.parse(await taskUpdate(client, { id: UUID, status: 'done' }));
      expect(out.error).toContain('migration 019');
      expect(out.error).toContain('docs/upgrading.md');
      expect(out.error).toContain(error.message);
      expect(client.from).not.toHaveBeenCalled();
    }
  });

  it('unrelated SQL errors are not mapped to the migration message', async () => {
    for (const error of [
      { code: '42883', message: 'operator does not exist: text = integer' },
      { code: '23514', message: 'new row violates check constraint "tasks_status_check"' },
      { message: 'function other_fn(uuid) does not exist' },
    ]) {
      const { client } = setup({ data: null, error });
      const out = JSON.parse(await taskUpdate(client, { id: UUID, status: 'done' }));
      expect(out).toEqual({ error: error.message });
    }
  });

  it('rejects metadata together with metadata_merge before any query', async () => {
    const { client, rpc } = setup({ data: [row()] });
    const out = JSON.parse(
      await taskUpdate(client, { id: UUID, metadata: { a: 1 }, metadata_merge: { b: 2 } }),
    );
    expect(out.error).toBe('Pass either metadata or metadata_merge, not both.');
    expect(client.from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a blank title reads only: a missing task is not found, an existing one is the title error', async () => {
    const missing = setup({ data: [row()] }, null);
    expect(JSON.parse(await taskUpdate(missing.client, { id: UUID, title: '  ' }))).toEqual({
      error: 'not found',
    });
    const present = setup({ data: [row()] });
    expect(JSON.parse(await taskUpdate(present.client, { id: UUID, title: '  ' }))).toEqual({
      error: 'title must be non-empty.',
    });
    expect(missing.rpc).not.toHaveBeenCalled();
    expect(present.rpc).not.toHaveBeenCalled();
  });

  it('the tool description no longer mentions the conflict guard or #115', () => {
    expect(updateDef.description).not.toContain('conflict');
    expect(updateDef.description).not.toContain('#115');
    expect(updateDef.description).toContain('atomically');
  });
});
