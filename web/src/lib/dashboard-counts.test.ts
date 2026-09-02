import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real select(...) call returns a Supabase query builder that is itself
// thenable and exposes .is()/.eq() filters returning the same thenable. This
// fake reproduces just enough of that shape to drive fetchDashboardCounts.
function fakeQuery(count: number | null) {
  const builder: {
    is: (...args: unknown[]) => typeof builder;
    eq: (...args: unknown[]) => typeof builder;
    then: (resolve: (v: { count: number | null }) => void) => void;
  } = {
    is: () => builder,
    eq: () => builder,
    then: (resolve) => resolve({ count }),
  };
  return builder;
}

describe('fetchDashboardCounts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('maps each table query to its named count', async () => {
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => {
        if (table === 'thoughts') return fakeQuery(7);
        if (table === 'current_wiki_pages') return fakeQuery(3);
        if (table === 'contradictions') return fakeQuery(2);
        throw new Error(`unexpected table ${table}`);
      }),
    }));

    vi.doMock('./supabase-server', () => ({
      createClient: vi.fn(async () => ({ from })),
    }));

    const { fetchDashboardCounts } = await import('./dashboard-counts');
    const counts = await fetchDashboardCounts();

    expect(counts).toEqual({
      totalThoughts: 7,
      wikiPages: 3,
      openContradictions: 2,
    });
  });

  it('defaults a null count to 0', async () => {
    const from = vi.fn(() => ({
      select: vi.fn(() => fakeQuery(null)),
    }));

    vi.doMock('./supabase-server', () => ({
      createClient: vi.fn(async () => ({ from })),
    }));

    const { fetchDashboardCounts } = await import('./dashboard-counts');
    const counts = await fetchDashboardCounts();

    expect(counts).toEqual({
      totalThoughts: 0,
      wikiPages: 0,
      openContradictions: 0,
    });
  });
});
