import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Creates a chainable mock that mimics Supabase query builder.
 * Call resolvesWith(data, error?) to set what the chain returns.
 */
export function createMockSupabase() {
  let resolveData: unknown = null;
  let resolveError: { message: string } | null = null;
  let resolveCount: number | null = null;

  const builder: Record<string, unknown> = {};
  const chainMethods = [
    "from",
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "neq",
    "is",
    "not",
    "gte",
    "lte",
    "order",
    "limit",
    "rpc",
  ];

  for (const method of chainMethods) {
    builder[method] = vi.fn().mockImplementation(() => builder);
  }

  // Terminal: .then() makes it awaitable
  builder.then = (resolve: (value: unknown) => void) => {
    resolve({ data: resolveData, error: resolveError, count: resolveCount });
  };

  return {
    client: builder as unknown as SupabaseClient,
    /** Set what the next query chain resolves with */
    resolvesWith(data: unknown, error?: { message: string } | null, count?: number | null) {
      resolveData = data;
      resolveError = error ?? null;
      resolveCount = count ?? null;
    },
  };
}

/**
 * Creates a mock that supports Promise.all with multiple queries.
 * Each call to from() returns a separate chain that resolves independently.
 */
export function createMultiQueryMockSupabase(results: Array<{ data: unknown; error?: { message: string } | null; count?: number | null }>) {
  let callIndex = 0;

  function makeChain(result: { data: unknown; error?: { message: string } | null; count?: number | null }) {
    const chain: Record<string, unknown> = {};
    const chainMethods = [
      "select", "insert", "update", "delete",
      "eq", "neq", "is", "not", "gte", "lte",
      "order", "limit",
    ];
    for (const method of chainMethods) {
      chain[method] = vi.fn().mockImplementation(() => chain);
    }
    chain.then = (resolve: (value: unknown) => void) => {
      resolve({ data: result.data, error: result.error ?? null, count: result.count ?? null });
    };
    return chain;
  }

  const client = {
    from: vi.fn().mockImplementation(() => {
      const result = results[callIndex] ?? results[results.length - 1];
      callIndex++;
      return makeChain(result);
    }),
    rpc: vi.fn(),
  } as unknown as SupabaseClient;

  return { client };
}
