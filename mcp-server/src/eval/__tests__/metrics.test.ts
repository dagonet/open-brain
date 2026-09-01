import { describe, it, expect } from 'vitest';
import { recallAtK, mrr } from '../metrics.js';

// ---------------------------------------------------------------------------
// recallAtK
// ---------------------------------------------------------------------------

describe('recallAtK', () => {
  it('returns 1.0 when all expected items are in the top K', () => {
    expect(recallAtK(['a', 'b'], ['a', 'b', 'c', 'd'], 2)).toBe(1.0);
  });

  it('returns 0.5 when half the expected items are in the top K', () => {
    expect(recallAtK(['a', 'c'], ['a', 'b', 'c', 'd'], 2)).toBe(0.5);
  });

  it('returns 0.0 when no expected items are in the top K', () => {
    expect(recallAtK(['x', 'y'], ['a', 'b', 'c', 'd'], 2)).toBe(0.0);
  });

  it('returns 1.0 when expected is empty', () => {
    expect(recallAtK([], ['a', 'b'], 5)).toBe(1.0);
  });

  it('respects K cutoff even when actual is longer', () => {
    // expected C is at index 5 (6th position) -- outside K=5
    expect(recallAtK(['c'], ['a', 'b', 'c', 'd', 'e', 'f'], 5)).toBe(1.0);
  });

  it('handles K larger than actual length gracefully', () => {
    expect(recallAtK(['a', 'b'], ['a'], 10)).toBe(0.5);
  });

  it('works with duplicate IDs in actual (treats as-is)', () => {
    expect(recallAtK(['a'], ['a', 'a', 'b'], 1)).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// MRR
// ---------------------------------------------------------------------------

describe('mrr', () => {
  it('returns 1.0 when first result matches', () => {
    expect(mrr(['a'], ['a', 'b', 'c'])).toBe(1.0);
  });

  it('returns 0.5 when second result is the first match', () => {
    expect(mrr(['b'], ['a', 'b', 'c'])).toBe(0.5);
  });

  it('returns 1/3 when third result is the first match', () => {
    expect(mrr(['c'], ['a', 'b', 'c'])).toBe(1 / 3);
  });

  it('returns 0.0 when no expected items are found', () => {
    expect(mrr(['x', 'y'], ['a', 'b', 'c'])).toBe(0.0);
  });

  it('finds the earliest of multiple expected items', () => {
    // 'b' appears at index 1 (rank 2) --> MRR = 1/2
    expect(mrr(['x', 'b', 'y'], ['a', 'b', 'c'])).toBe(0.5);
  });

  it('returns 0 for empty expected set (degenerate)', () => {
    expect(mrr([], ['a', 'b'])).toBe(0.0);
  });

  it('handles empty actual list', () => {
    expect(mrr(['a'], [])).toBe(0.0);
  });
});
