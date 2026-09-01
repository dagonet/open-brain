import { describe, it, expect } from 'vitest';
import { contradictionsList } from '../contradictions-list.js';
import { createMockSupabase } from './helpers.js';

describe('contradictionsList', () => {
  it('returns empty list when no contradictions exist', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    const result = JSON.parse(await contradictionsList(mock.client, {}));
    expect(result.status).toBe('ok');
    expect(result.contradictions).toEqual([]);
  });

  it('returns error on supabase failure', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: 'connection error' });

    const result = JSON.parse(await contradictionsList(mock.client, {}));
    expect(result.error).toBe('connection error');
  });
});
