#!/usr/bin/env node
/**
 * Ranking eval runner.
 *
 * For each golden query: calls match_thoughts RPC (v1) and optionally
 * match_thoughts_v2 RPC (v2), computes recall@5, recall@10, and MRR,
 * prints a comparison table.
 *
 * Exit codes:
 *   0  - all good (v2 not deployed, or all v2 thresholds met)
 *   1  - threshold failure when v2 exists
 *
 * Environment:
 *   SUPABASE_URL              required (unless CI — see below)
 *   SUPABASE_SERVICE_ROLE_KEY required
 *
 * CI-safe: if SUPABASE_URL is unset, prints a message and exits 0.
 */

import { createClient } from '@supabase/supabase-js';
import { GOLDEN_QUERIES } from './fixtures.js';
import { recallAtK, mrr } from './metrics.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface QueryResult {
  id: string;
  /** Supabase RPC returns { id, ... } rows */
  similarity?: number;
}

function formatPct(v: number): string {
  return (v * 100).toFixed(1) + '%';
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // CI-safe: skip when no DB
  if (!url) {
    console.log('SUPABASE_URL not set — skipping eval (CI mode).');
    process.exit(0);
  }
  if (!key) {
    console.error('SUPABASE_SERVICE_ROLE_KEY not set.');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  // Detect whether match_thoughts_v2 exists
  let v2Available = false;
  {
    const { error } = await supabase.rpc('match_thoughts_v2', {
      query_embedding: JSON.stringify(new Array(1536).fill(0)),
      match_count: 1,
      filter_thought_type: null,
      filter_people: null,
      filter_topics: null,
      filter_days: null,
      filter_project: null,
    });
    if (error && error.message && error.message.includes('does not exist')) {
      console.log('match_thoughts_v2 not deployed - running v1 baseline only.');
    } else if (error) {
      // Some other error — surface it per PR #10 discipline
      console.error('Error probing match_thoughts_v2:', error.message);
      process.exit(1);
    } else {
      v2Available = true;
      console.log('match_thoughts_v2 detected - running comparison.');
    }
  }

  // -----------------------------------------------------------------------
  // Per-query eval
  // -----------------------------------------------------------------------

  interface EvalRow {
    qId: string;
    desc: string;
    r1_5: number;
    r1_10: number;
    mrr1: number;
    r2_5: number | null;
    r2_10: number | null;
    mrr2: number | null;
    passed: boolean | null; // null when v2 not available
  }

  const rows: EvalRow[] = [];
  let anyFailure = false;

  for (const q of GOLDEN_QUERIES) {
    const queryEmbedding = JSON.stringify(q.embedding);
    const expected = q.expected_thought_ids;

    // -- v1 call --
    const { data: v1Data, error: v1Error } = await supabase.rpc('match_thoughts', {
      query_embedding: queryEmbedding,
      match_count: 10,
      filter_thought_type: null,
      filter_people: null,
      filter_topics: null,
      filter_days: null,
    });

    if (v1Error) {
      console.error('Error calling match_thoughts for %s: %s', q.id, v1Error.message);
      process.exit(1);
    }
    const v1Actual = ((v1Data as QueryResult[]) || []).map((r: QueryResult) => r.id);
    const v1r5 = recallAtK(expected, v1Actual, 5);
    const v1r10 = recallAtK(expected, v1Actual, 10);
    const v1m = mrr(expected, v1Actual);

    // -- v2 call (optional) --
    let v2r5: number | null = null;
    let v2r10: number | null = null;
    let v2m: number | null = null;
    let passed: boolean | null = null;

    if (v2Available) {
      // Spread optional params (e.g. filter_project) from golden query into v2 RPC args.
      // This lets queries like q-project-filter-alpha pass project-scoped filters.
      const v2Params: Record<string, unknown> = {
        query_embedding: queryEmbedding,
        match_count: 10,
        filter_thought_type: null,
        filter_people: null,
        filter_topics: null,
        filter_days: null,
        filter_project: null,
        ...(q.params ?? {}),
      };

      const { data: v2Data, error: v2Error } = await supabase.rpc('match_thoughts_v2', v2Params);

      if (v2Error) {
        // Surface error, don't mask it (PR #10)
        console.error('Error calling match_thoughts_v2 for %s: %s', q.id, v2Error.message);
        process.exit(1);
      }
      const v2Actual = ((v2Data as QueryResult[]) || []).map((r: QueryResult) => r.id);
      v2r5 = recallAtK(expected, v2Actual, 5);
      v2r10 = recallAtK(expected, v2Actual, 10);
      v2m = mrr(expected, v2Actual);

      passed = v2r5 >= q.min_recall_at_5 && v2r10 >= q.min_recall_at_10;
      if (!passed) anyFailure = true;
    }

    rows.push({
      qId: q.id,
      desc: q.description,
      r1_5: v1r5,
      r1_10: v1r10,
      mrr1: v1m,
      r2_5: v2r5,
      r2_10: v2r10,
      mrr2: v2m,
      passed,
    });
  }

  // -----------------------------------------------------------------------
  // Print table
  // -----------------------------------------------------------------------

  const sep = ' | ';
  const hdr1 =
    padRight('Query', 32) +
    sep +
    padRight('v1 R@5', 8) +
    sep +
    padRight('v1 R@10', 9) +
    sep +
    padRight('v1 MRR', 8);
  const hdr2 =
    padRight('', 32) +
    sep +
    padRight('v2 R@5', 8) +
    sep +
    padRight('v2 R@10', 9) +
    sep +
    padRight('v2 MRR', 8) +
    sep +
    'Passed';
  console.log('='.repeat(hdr1.length + 20));
  console.log(hdr1);
  console.log(hdr2);
  console.log('-'.repeat(hdr1.length + 20));

  for (const r of rows) {
    const l1 =
      padRight(r.desc.slice(0, 31), 32) +
      sep +
      padRight(formatPct(r.r1_5), 8) +
      sep +
      padRight(formatPct(r.r1_10), 9) +
      sep +
      padRight(formatPct(r.mrr1), 8);

    let l2 = padRight('', 32) + sep;
    if (r.r2_5 !== null) {
      l2 +=
        padRight(formatPct(r.r2_5), 8) +
        sep +
        padRight(formatPct(r.r2_10!), 9) +
        sep +
        padRight(formatPct(r.mrr2!), 8) +
        sep +
        (r.passed ? 'PASS' : 'FAIL');
    } else {
      l2 += padRight('N/A', 8) + sep + padRight('N/A', 9) + sep + padRight('N/A', 8);
    }
    console.log(l1);
    console.log(l2);
    console.log();
  }

  console.log('='.repeat(hdr1.length + 20));
  console.log();

  // -----------------------------------------------------------------------
  // Summarize
  // -----------------------------------------------------------------------

  if (!v2Available) {
    console.log(
      'v2 not deployed — v1 baseline recorded.  Install migrations 008+009 and redeploy to enable comparison.',
    );
    process.exit(0);
  }

  if (anyFailure) {
    console.log('FAIL: one or more v2 thresholds not met.');
    process.exit(1);
  }

  console.log('ALL PASS: v2 meets all recall thresholds.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
