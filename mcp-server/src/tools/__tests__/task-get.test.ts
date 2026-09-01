import { describe, it, expect, vi } from 'vitest';
import { taskGet } from '../task-get.js';
import { createMockSupabase } from './helpers.js';

describe('taskGet', () => {
  it('returns the task when found', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith({
      id: 'task-uuid',
      title: 'Found task',
      status: 'in_progress',
      project: 'test-project',
      description: null,
      priority: null,
      linked_thought_ids: [],
      metadata: {},
      status_history: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      deleted_at: null,
    });

    const result = JSON.parse(await taskGet(mock.client, { id: 'task-uuid' }));

    expect(result.id).toBe('task-uuid');
    expect(result.title).toBe('Found task');

    const m = mock.client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(m.from).toHaveBeenCalledWith('tasks');
    expect(m.eq).toHaveBeenCalledWith('id', 'task-uuid');
  });

  it('returns not found error when task does not exist', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null);

    const result = JSON.parse(await taskGet(mock.client, { id: 'nonexistent-uuid' }));

    expect(result.error).toBe('not found');
  });

  it('returns not found error when task has been soft-deleted', async () => {
    const mock = createMockSupabase();
    // maybeSingle returns null because .is("deleted_at", null) filters it out
    mock.resolvesWith(null);

    const result = JSON.parse(await taskGet(mock.client, { id: 'deleted-uuid' }));

    expect(result.error).toBe('not found');
  });

  it('returns error on supabase read failure', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: 'read error' });

    const result = JSON.parse(await taskGet(mock.client, { id: 'error-uuid' }));

    expect(result.error).toBe('read error');
  });
});
