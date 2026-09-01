import { describe, it, expect, vi } from 'vitest';
import { taskUpdate } from '../task-update.js';
import { createMultiQueryMockSupabase } from './helpers.js';

describe('taskUpdate', () => {
  it('edits title', async () => {
    const { client } = createMultiQueryMockSupabase([
      {
        data: {
          id: 'task-uuid',
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
        },
      },
      {
        data: {
          id: 'task-uuid',
          title: 'New title',
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
        },
      },
    ]);

    const result = JSON.parse(await taskUpdate(client, { id: 'task-uuid', title: 'New title' }));

    expect(result.title).toBe('New title');

    const m = client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(m.from).toHaveBeenCalledWith('tasks');
  });

  it('rejects empty title with error', async () => {
    const { client } = createMultiQueryMockSupabase([
      {
        data: {
          id: 'task-uuid',
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
        },
      },
    ]);

    const result = JSON.parse(await taskUpdate(client, { id: 'task-uuid', title: '' }));

    expect(result.error).toBe('title must be non-empty.');

    // from() called once for read only — no update attempt
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it('status change appends to status_history', async () => {
    const { client } = createMultiQueryMockSupabase([
      {
        data: {
          id: 'task-uuid',
          title: 'My task',
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
        },
      },
      {
        data: {
          id: 'task-uuid',
          title: 'My task',
          status: 'in_progress',
          status_history: [{ status: 'in_progress', at: expect.any(String), note: null }],
          project: null,
          description: null,
          priority: null,
          linked_thought_ids: [],
          metadata: {},
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          deleted_at: null,
        },
      },
    ]);

    const result = JSON.parse(await taskUpdate(client, { id: 'task-uuid', status: 'in_progress' }));

    expect(result.status).toBe('in_progress');
  });

  it('status change with note appends note to status_history', async () => {
    const { client } = createMultiQueryMockSupabase([
      {
        data: {
          id: 'task-uuid',
          title: 'My task',
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
        },
      },
      {
        data: {
          id: 'task-uuid',
          title: 'My task',
          status: 'blocked',
          status_history: [
            { status: 'blocked', at: expect.any(String), note: 'Waiting on review' },
          ],
          project: null,
          description: null,
          priority: null,
          linked_thought_ids: [],
          metadata: {},
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          deleted_at: null,
        },
      },
    ]);

    const result = JSON.parse(
      await taskUpdate(client, {
        id: 'task-uuid',
        status: 'blocked',
        note: 'Waiting on review',
      }),
    );

    expect(result.status).toBe('blocked');
  });

  it('cancelling a task sets deleted_at', async () => {
    const { client } = createMultiQueryMockSupabase([
      {
        data: {
          id: 'task-uuid',
          title: 'My task',
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
        },
      },
      {
        data: {
          id: 'task-uuid',
          title: 'My task',
          status: 'cancelled',
          status_history: [{ status: 'cancelled', at: expect.any(String), note: null }],
          project: null,
          description: null,
          priority: null,
          linked_thought_ids: [],
          metadata: {},
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          deleted_at: expect.any(String),
        },
      },
    ]);

    const result = JSON.parse(await taskUpdate(client, { id: 'task-uuid', status: 'cancelled' }));

    expect(result.status).toBe('cancelled');
    expect(result.deleted_at).toBeTruthy();
  });

  it('returns not found for nonexistent task', async () => {
    const { client } = createMultiQueryMockSupabase([
      {
        data: null,
      },
    ]);

    const result = JSON.parse(await taskUpdate(client, { id: 'nonexistent', title: 'New title' }));

    expect(result.error).toBe('not found');
  });

  it('returns error on supabase read failure', async () => {
    const { client } = createMultiQueryMockSupabase([
      {
        data: null,
        error: { message: 'read failed' },
      },
    ]);

    const result = JSON.parse(await taskUpdate(client, { id: 'error-uuid', title: 'New title' }));

    expect(result.error).toBe('read failed');
  });

  it('same status does not append to status_history', async () => {
    const { client } = createMultiQueryMockSupabase([
      {
        data: {
          id: 'task-uuid',
          title: 'My task',
          status: 'open',
          status_history: [
            { status: 'in_progress', at: '2026-01-01T00:00:00Z', note: null },
            { status: 'open', at: '2026-01-02T00:00:00Z', note: 'reopened' },
          ],
          project: null,
          description: null,
          priority: null,
          linked_thought_ids: [],
          metadata: {},
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          deleted_at: null,
        },
      },
      {
        data: {
          id: 'task-uuid',
          title: 'My task',
          status: 'open',
          status_history: [
            { status: 'in_progress', at: '2026-01-01T00:00:00Z', note: null },
            { status: 'open', at: '2026-01-02T00:00:00Z', note: 'reopened' },
          ],
          project: null,
          description: null,
          priority: null,
          linked_thought_ids: [],
          metadata: {},
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          deleted_at: null,
        },
      },
    ]);

    const result = JSON.parse(
      await taskUpdate(client, { id: 'task-uuid', title: 'Just a rename' }),
    );

    // History unchanged because only title changed
    expect(result.status_history).toHaveLength(2);
  });
});
