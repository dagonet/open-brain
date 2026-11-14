import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { taskUpdate } from '../task-update.js';
import { createMultiQueryMockSupabase } from './helpers.js';

const ID = 'task-uuid';

function taskRow(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    title: 'Old title',
    status: 'open',
    status_history: [],
    project: null,
    description: null,
    priority: null,
    linked_thought_ids: [],
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...over,
  };
}

/** rpc resolves with `rpcResult`; from() (blank-title read only) with `read`. */
function mockClient(
  rpcResult: { data: unknown; error?: { message: string } | null },
  read: unknown = taskRow(),
) {
  const reader = createMultiQueryMockSupabase([{ data: read }]);
  const rpc = vi.fn().mockResolvedValue({ error: null, ...rpcResult });
  const client = { from: reader.client.from, rpc } as unknown as SupabaseClient;
  return { client, rpc };
}

describe('taskUpdate', () => {
  it('edits title through task_apply_update', async () => {
    const { client, rpc } = mockClient({ data: [taskRow({ title: 'New title' })] });
    const result = JSON.parse(await taskUpdate(client, { id: ID, title: 'New title' }));
    expect(result.title).toBe('New title');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('task_apply_update', {
      p_id: ID,
      p_patch: { title: 'New title' },
    });
  });

  it('rejects empty title with error and writes nothing', async () => {
    const { client, rpc } = mockClient({ data: [taskRow()] });
    const result = JSON.parse(await taskUpdate(client, { id: ID, title: '   ' }));
    expect(result.error).toBe('title must be non-empty.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('status change sends p_status; the database appends the history entry', async () => {
    const history = [{ status: 'in_progress', at: '2026-06-15T12:00:00.000Z', note: null }];
    const { client, rpc } = mockClient({
      data: [taskRow({ status: 'in_progress', status_history: history })],
    });
    const result = JSON.parse(await taskUpdate(client, { id: ID, status: 'in_progress' }));
    expect(result.status_history).toEqual(history);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('task_apply_update', {
      p_id: ID,
      p_patch: {},
      p_status: 'in_progress',
    });
  });

  it('status change with note sends p_note', async () => {
    const { client, rpc } = mockClient({ data: [taskRow({ status: 'done' })] });
    await taskUpdate(client, { id: ID, status: 'done', note: 'finished' });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('task_apply_update', {
      p_id: ID,
      p_patch: {},
      p_status: 'done',
      p_note: 'finished',
    });
  });

  it('cancelling sends p_status cancelled and returns the row the database wrote', async () => {
    const written = taskRow({ status: 'cancelled', deleted_at: '2026-06-15T12:00:00+00:00' });
    const { client, rpc } = mockClient({ data: [written] });
    const result = JSON.parse(await taskUpdate(client, { id: ID, status: 'cancelled' }));
    expect(result.deleted_at).toBe('2026-06-15T12:00:00+00:00');
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_status: 'cancelled' });
  });

  it('returns not found for nonexistent task', async () => {
    const { client } = mockClient({ data: [] });
    const result = JSON.parse(await taskUpdate(client, { id: ID, title: 'x' }));
    expect(result.error).toBe('not found');
  });

  it('returns error on rpc failure', async () => {
    const { client } = mockClient({ data: null, error: { message: 'DB connection failed' } });
    const result = JSON.parse(await taskUpdate(client, { id: ID, title: 'x' }));
    expect(result.error).toBe('DB connection failed');
  });

  it('same status without note is sent as is; the database returns the row unchanged', async () => {
    const current = taskRow({ status: 'open' });
    const { client } = mockClient({ data: [current] });
    const out = await taskUpdate(client, { id: ID, status: 'open' });
    expect(out).toBe(JSON.stringify(current));
  });
});
