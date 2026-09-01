import { describe, it, expect, vi } from 'vitest';
import { entitiesGraph } from '../entities-graph.js';
import { createMockSupabase } from './helpers.js';

describe('entitiesGraph', () => {
  it('returns neighbors from entity_neighbors RPC', async () => {
    const mock = createMockSupabase();
    const neighbors = [
      {
        source_key: 'open-brain',
        target_key: 'claude-code',
        weight: 5,
        display_name: 'Claude Code',
        entity_type: 'tool',
        thought_count: 3,
      },
      {
        source_key: 'open-brain',
        target_key: 'memory-system',
        weight: 3,
        display_name: 'Memory System',
        entity_type: 'concept',
        thought_count: 7,
      },
    ];
    mock.resolvesWith(neighbors);

    const result = JSON.parse(await entitiesGraph(mock.client, { entity: 'Open Brain' }));

    expect(result).toEqual({
      entity: 'open brain',
      neighbors,
    });
  });

  it('normalizes entity key to lower case and trims whitespace', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await entitiesGraph(mock.client, { entity: '  Open Brain  ' });

    const rpcMock = mock.client.rpc as unknown as ReturnType<typeof vi.fn>;
    expect(rpcMock).toHaveBeenCalledWith('entity_neighbors', {
      seed_key: 'open brain',
      max_nodes: 50,
    });
  });

  it('uses default max_nodes of 50', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await entitiesGraph(mock.client, { entity: 'test' });

    const rpcMock = mock.client.rpc as unknown as ReturnType<typeof vi.fn>;
    expect(rpcMock).toHaveBeenCalledWith('entity_neighbors', {
      seed_key: 'test',
      max_nodes: 50,
    });
  });

  it('accepts custom max_nodes', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await entitiesGraph(mock.client, {
      entity: 'test',
      max_nodes: 100,
    });

    const rpcMock = mock.client.rpc as unknown as ReturnType<typeof vi.fn>;
    expect(rpcMock).toHaveBeenCalledWith('entity_neighbors', {
      seed_key: 'test',
      max_nodes: 100,
    });
  });

  it('returns empty neighborhood when RPC returns zero rows', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    const result = JSON.parse(await entitiesGraph(mock.client, { entity: 'nonexistent' }));

    expect(result).toEqual({
      entity: 'nonexistent',
      neighbors: [],
    });
  });

  it('returns empty neighborhood when RPC returns null', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null);

    const result = JSON.parse(await entitiesGraph(mock.client, { entity: 'null-result' }));

    expect(result).toEqual({
      entity: 'null-result',
      neighbors: [],
    });
  });

  it('returns error on supabase RPC failure', async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: 'rpc failed' });

    const result = JSON.parse(await entitiesGraph(mock.client, { entity: 'test' }));

    expect(result.error).toBe('rpc failed');
  });
});
