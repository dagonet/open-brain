import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ToolDefinition } from './registry.js';

export interface EntitiesGraphParams {
  entity: string;
  max_nodes?: number;
}

export async function entitiesGraph(
  supabase: SupabaseClient,
  params: EntitiesGraphParams,
): Promise<string> {
  const { entity, max_nodes = 50 } = params;
  const seed_key = entity.trim().toLowerCase();

  const { data, error } = await supabase.rpc('entity_neighbors', {
    seed_key,
    max_nodes,
  });

  if (error) {
    return JSON.stringify({ error: error.message });
  }

  return JSON.stringify({
    entity: seed_key,
    neighbors: Array.isArray(data) ? data : [],
  });
}

export const definition: ToolDefinition = {
  name: 'entities_graph',
  description:
    'Get the immediate neighborhood (neighbors) of an entity in the mind-graph. Returns connected entities with edge weight, display name, entity type, and shared thought count.',
  schema: {
    entity: z.string().describe('The entity name to explore in the graph'),
    max_nodes: z.number().optional().default(50).describe('Max nodes to return (default 50)'),
  },
  handler: (deps, params) => entitiesGraph(deps.supabase, params as unknown as EntitiesGraphParams),
};
