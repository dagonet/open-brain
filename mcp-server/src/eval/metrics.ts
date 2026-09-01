/**
 * Information retrieval metrics for ranking evaluation.
 *
 * All functions are pure --- they operate on arrays of IDs, not on database
 * results --- so they are trivially testable without mocking.
 */

/**
 * Compute recall@K.
 *
 * @param expected - the set of relevant (expected) thought IDs
 * @param actual   - ranked list of returned thought IDs (top-K is implicit)
 * @param k        - cutoff rank
 * @returns fraction of expected items found in the top K results (0..1)
 */
export function recallAtK(expected: string[], actual: string[], k: number): number {
  if (expected.length === 0) return 1.0;
  const topK = actual.slice(0, k);
  const found = expected.filter((id) => topK.includes(id));
  return found.length / expected.length;
}

/**
 * Compute Mean Reciprocal Rank (MRR).
 *
 * MRR measures at what rank the first relevant result appears, averaged over
 * queries.  For a single query, it is simply 1 / rank_of_first_relevant_hit
 * (0 if none).
 *
 * @param expected - relevant IDs for this query
 * @param actual   - ranked list of returned IDs
 * @returns reciprocal rank of the first relevant result (0 if none found)
 */
export function mrr(expected: string[], actual: string[]): number {
  for (let i = 0; i < actual.length; i++) {
    if (expected.includes(actual[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}
