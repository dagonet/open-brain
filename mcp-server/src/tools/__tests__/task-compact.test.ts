import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { taskList, definition as listDef } from '../task-list.js';
import { taskGet, definition as getDef, type TaskGetParams } from '../task-get.js';
import { taskUpdate, definition as updateDef, type TaskUpdateParams } from '../task-update.js';
import { createMockSupabase, createMultiQueryMockSupabase } from './helpers.js';

type Mocks = Record<string, ReturnType<typeof vi.fn>>;
const mocks = (x: unknown) => x as Mocks;

const NOW = new Date('2026-06-15T12:00:00.000Z');
const NOW_ISO = NOW.toISOString();
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
    expect(schema.safeParse({ stale_days: 0 }).success).toBe(false);
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
    });
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

  it('non-compact keeps select(*) with the new filters', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([row()]);
    await taskList(mock.client, { stale_days: 1 });
    expect(mocks(mock.client).select).toHaveBeenCalledExactlyOnceWith('*');
  });
});

describe('task_get', () => {
  it('baseline: unchanged answer and builder calls', async () => {
    const params = z.object(getDef.schema).parse({ id: UUID }) as TaskGetParams;
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
    expect(out).toEqual({
      id: UUID,
      title: 'T',
      status: 'open',
      priority: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      planned: true,
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

  it('schema bounds description_chars to 0..2000', () => {
    const schema = z.object(getDef.schema);
    expect(schema.safeParse({ id: UUID, description_chars: 2001 }).success).toBe(false);
    expect(schema.safeParse({ id: UUID, description_chars: -1 }).success).toBe(false);
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
  function setup(current: Record<string, unknown>, written: unknown, err?: unknown) {
    return createMultiQueryMockSupabase([
      { data: current },
      { data: written, error: err as { message: string } | null | undefined },
    ]);
  }

  it('baseline: status change with note keeps the exact payload shape', async () => {
    const params = z.object(updateDef.schema).parse({
      id: UUID,
      status: 'done',
      note: 'ok',
    }) as TaskUpdateParams;
    expect(params).toEqual({ id: UUID, status: 'done', note: 'ok' });
    const written = row({ status: 'done' });
    const { client, chains } = setup(row(), written);
    const out = await taskUpdate(client, params);
    expect(out).toBe(JSON.stringify(written));
    const w = chains[1] as Mocks;
    expect(w.update).toHaveBeenCalledExactlyOnceWith({
      status: 'done',
      status_history: [{ status: 'done', at: NOW_ISO, note: 'ok' }],
    });
    expect(w.eq.mock.calls).toEqual([['id', UUID]]);
    expect(w.select).toHaveBeenCalledTimes(1);
    expect(w.single).toHaveBeenCalledTimes(1);
  });

  it('baseline: plain field update has no guard', async () => {
    const { client, chains } = setup(row(), row({ title: 'N' }));
    await taskUpdate(client, { id: UUID, title: 'N', priority: 2 });
    const w = chains[1] as Mocks;
    expect(w.update).toHaveBeenCalledExactlyOnceWith({ title: 'N', priority: 2 });
    expect(w.eq.mock.calls).toEqual([['id', UUID]]);
  });

  it('status change without note records note: null and no kind', async () => {
    const { client, chains } = setup(row(), row());
    await taskUpdate(client, { id: UUID, status: 'blocked' });
    expect((chains[1] as Mocks).update).toHaveBeenCalledWith({
      status: 'blocked',
      status_history: [{ status: 'blocked', at: NOW_ISO, note: null }],
    });
  });

  it('note only appends a kind:note entry and guards on updated_at', async () => {
    const prior = { status: 'open', at: 'x', note: null };
    const { client, chains } = setup(row({ status_history: [prior] }), row());
    await taskUpdate(client, { id: UUID, note: 'hello' });
    const w = chains[1] as Mocks;
    expect(w.update).toHaveBeenCalledExactlyOnceWith({
      status_history: [prior, { status: 'open', at: NOW_ISO, note: 'hello', kind: 'note' }],
    });
    expect(w.eq.mock.calls).toEqual([
      ['id', UUID],
      ['updated_at', '2026-01-02T00:00:00Z'],
    ]);
  });

  it('same status plus note is a note-only entry and does not rewrite status', async () => {
    const { client, chains } = setup(row({ status: 'blocked' }), row());
    await taskUpdate(client, { id: UUID, status: 'blocked', note: 'still stuck' });
    expect((chains[1] as Mocks).update).toHaveBeenCalledWith({
      status_history: [{ status: 'blocked', at: NOW_ISO, note: 'still stuck', kind: 'note' }],
    });
  });

  it('note only with non-array history starts a new array', async () => {
    const { client, chains } = setup(row({ status_history: null }), row());
    await taskUpdate(client, { id: UUID, note: 'n' });
    expect((chains[1] as Mocks).update).toHaveBeenCalledWith({
      status_history: [{ status: 'open', at: NOW_ISO, note: 'n', kind: 'note' }],
    });
  });

  it('metadata_merge merges shallowly, null deletes, and guards', async () => {
    const { client, chains } = setup(
      row({ metadata: { keep: 1, drop: 2, plan: { old: true } } }),
      row(),
    );
    await taskUpdate(client, {
      id: UUID,
      metadata_merge: { drop: null, plan: fullPlan, added: 'x' },
    });
    const w = chains[1] as Mocks;
    expect(w.update).toHaveBeenCalledExactlyOnceWith({
      metadata: { keep: 1, plan: fullPlan, added: 'x' },
    });
    expect(w.eq.mock.calls).toContainEqual(['updated_at', '2026-01-02T00:00:00Z']);
  });

  it('metadata_merge treats null and non-object metadata as {}', async () => {
    for (const metadata of [null, 'str', ['a']]) {
      const { client, chains } = setup(row({ metadata }), row());
      await taskUpdate(client, { id: UUID, metadata_merge: { a: 1, b: null } });
      expect((chains[1] as Mocks).update).toHaveBeenCalledWith({ metadata: { a: 1 } });
    }
  });

  it('rejects metadata together with metadata_merge before any query', async () => {
    const { client } = setup(row(), row());
    const out = JSON.parse(
      await taskUpdate(client, { id: UUID, metadata: { a: 1 }, metadata_merge: { b: 2 } }),
    );
    expect(out.error).toBeTypeOf('string');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('echo compact returns the small shape from the written row', async () => {
    const written = row({ status: 'done', priority: 3, status_history: [1, 2], title: 'big' });
    const { client } = setup(row(), written);
    const out = JSON.parse(await taskUpdate(client, { id: UUID, status: 'done', echo: 'compact' }));
    expect(out).toEqual({
      id: UUID,
      status: 'done',
      priority: 3,
      updated_at: '2026-01-02T00:00:00Z',
      history_len: 2,
    });
  });

  it("echo 'full' equals the default answer", async () => {
    const written = row({ title: 'N' });
    const { client } = setup(row(), written);
    const out = await taskUpdate(client, { id: UUID, title: 'N', echo: 'full' });
    expect(out).toBe(JSON.stringify(written));
  });

  it('guarded write with no matching row returns a conflict error', async () => {
    const { client } = setup(row(), null, { message: 'Cannot coerce', code: 'PGRST116' });
    const out = JSON.parse(await taskUpdate(client, { id: UUID, note: 'n' }));
    expect(out).toEqual({ error: 'conflict, re-read and retry' });
  });

  it('other write errors on a guarded write keep their message', async () => {
    const { client } = setup(row(), null, { message: 'boom', code: '500' });
    const out = JSON.parse(await taskUpdate(client, { id: UUID, note: 'n' }));
    expect(out).toEqual({ error: 'boom' });
  });

  it('unguarded write keeps the raw PGRST116 message', async () => {
    const { client } = setup(row(), null, { message: 'Cannot coerce', code: 'PGRST116' });
    const out = JSON.parse(await taskUpdate(client, { id: UUID, title: 'N' }));
    expect(out).toEqual({ error: 'Cannot coerce' });
  });

  it('a call that changes nothing returns the current row without writing', async () => {
    const current = row();
    const { client } = setup(current, null);
    const out = await taskUpdate(client, { id: UUID });
    expect(out).toBe(JSON.stringify(current));
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});
