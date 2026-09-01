import { describe, it, expect, vi } from 'vitest';
import { entitiesSearch } from '../entities-search.js';
import { createMockSupabase } from './helpers.js';

describe('entitiesSearch', () => {
  it('returns entity search results from entity_search RPC', async () => {
    const mock = createMockSupabase();
    const rows = [
      {
        entity_key: 'open-brain',
        display_name: 'Open Brain',
        entity_type: 'project',
        mention_count: 42,
        thought_count: 15,
        thought_ids: ['uuid-1', 'uuid-2'],
        last_mentioned_at: '2026-07-01T00:00:00Z',
      },
    ];
    mock.resolvesWith(rows);

    const result = JSON.parse(await entitiesSearch(mock.client, { query: 'open-brain' }));

    expect(result).toEqual(rows);
  });

  it('passes query_text, filter_type, and result_limit to entity_search RPC', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await entitiesSearch(mock.client, {
      query: 'test entity',
      entity_type: 'project',
      limit: 5,
    });

    const rpcMock = mock.client.rpc as unknown as ReturnType<typeof vi.fn>;
    expect(rpcMock).toHaveBeenCalledWith('entity_search', {
      query_text: 'test entity',
      filter_type: 'project',
      result_limit: 5,
    });
  });

  it('uses default limit of 20', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await entitiesSearch(mock.client, { query: 'test' });

    const rpcMock = mock.client.rpc as unknown as ReturnType<typeof vi.fn>;
    expect(rpcMock).toHaveBeenCalledWith('entity_search', {
      query_text: 'test',
      filter_type: null,
      result_limit: 20,
    });
  });

  it('passes null filter_type when entity_type is omitted', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await entitiesSearch(mock.client, { query: 'test' });

    const rpcMock = mock.client.rpc as unknown as ReturnType<typeof vi.fn>;
    expect(rpcMock.mock.calls[0][1].filter_type).toBeNull();
  });

  it('returns error on supabase RPC failure', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: 'function not found' });

    const result = JSON.parse(await entitiesSearch(mock.client, { query: 'test' }));

    expect(result.error).toBe('function not found');
  });
});
