/**
 * Deterministic Eval Fixtures --- synthetic 1536-d thought vectors.
 *
 * == Why synthetic vectors instead of real OpenAI embeddings? ==
 *
 * Embedding quality is NOT under test here.  What IS under test:
 *   - Does match_thoughts_v2 rank thoughts in the correct order?
 *   - Are the score modifiers (recency decay, salience weight, contradiction
 *     penalty, supersede exclusion) applied as designed?
 *
 * Synthetic vectors give us **exact analytical control** over cosine
 * relationships so each golden query has KNOWN nearest neighbors with KNOWN
 * margins --- something real embeddings can never provide.
 *
 * == Construction ==
 *
 * 1. We define NUM_BASES = 8 topic-centroid vectors in a small active
 *    subspace (dims 0..119, so each centroid gets 15 dims).
 * 2. Each centroid is converted to a unit vector (L2-normalized in the full
 *    1536-d space --- the out-of-subspace dims are 0 so normalization just
 *    divides by the subspace norm).
 * 3. Each thought = its topic centroid + Gaussian noise (seeded LCG, seed
 *    derived from thought UUID), then renormalized to unit length.
 * 4. Each golden query = a pure centroid vector, so its exact top-N
 *    neighbors are the thoughts in that topic cluster.
 * 5. Inter-cluster cosine values are kept low (orthogonal centroids), so
 *    rank boundaries are sharp.
 *
 * == Unit-length guarantee ==
 *
 * All returned vectors are normalized to |v|_2 = 1.  Cosine similarity
 * between two such vectors equals their dot product, making all downstream
 * math exact.
 */


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seeded 32-bit LCG (Numerical Recipes). */
function lcg(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
}

/** Deterministic seed from a UUID string (cheap hash of the hex). */
function seedFromUuid(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) {
    h = ((h << 5) - h + uuid.charCodeAt(i)) | 0;
  }
  return h;
}

/** L2 norm. */
function norm(v: number[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

/** Normalise a vector to unit length in-place, returns it. */
function normalise(v: number[]): number[] {
  const n = norm(v);
  if (n < 1e-12) return v;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}


// ---------------------------------------------------------------------------
// Centroid construction
// ---------------------------------------------------------------------------

const DIM = 1536;
const NUM_BASES = 8;

function buildCentroids(): number[][] {
  const centroids: number[][] = [];
  const val = 1 / Math.sqrt(15);
  for (let c = 0; c < NUM_BASES; c++) {
    const v = new Array(DIM).fill(0);
    const start = c * 15;
    for (let d = start; d < start + 15; d++) {
      v[d] = val;
    }
    centroids.push(v);
  }
  return centroids;
}

const CENTROIDS = buildCentroids();

function makeThoughtVector(
  centroidIndex: number,
  uuid: string,
  noiseAmplitude = 0.15,
): number[] {
  const base = CENTROIDS[centroidIndex];
  const noiseDims = 30;
  const rng = lcg(seedFromUuid(uuid));
  const raw = [...base];
  for (let i = 0; i < noiseDims; i++) {
    const u1 = rng();
    const u2 = rng();
    const g = Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2);
    raw[1024 + i] = g * noiseAmplitude * 0.1;
  }
  return normalise(raw);
}

function makeQueryVector(centroidIndex: number): number[] {
  return [...CENTROIDS[centroidIndex]];
}


// ---------------------------------------------------------------------------
// Fixture IDs
// ---------------------------------------------------------------------------

export const FIXTURE_UUIDS = {
  freshDecisionAlpha1: "a0000000-0000-0000-0000-000000000001",
  freshDecisionAlpha2: "a0000000-0000-0000-0000-000000000002",
  staleInsightAlpha1: "a0000000-0000-0000-0000-000000000003",
  staleInsightAlpha2: "a0000000-0000-0000-0000-000000000004",
  freshDecisionBeta1: "a0000000-0000-0000-0000-000000000005",
  freshDecisionBeta2: "a0000000-0000-0000-0000-000000000006",
  noteBeta1: "a0000000-0000-0000-0000-000000000007",
  noteBeta2: "a0000000-0000-0000-0000-000000000008",
  freshAction1: "a0000000-0000-0000-0000-000000000009",
  freshAction2: "a0000000-0000-0000-0000-000000000010",
  oldSalientDecision: "a0000000-0000-0000-0000-000000000011",
  mediumAlphaNote1: "a0000000-0000-0000-0000-000000000012",
  freshInsightBeta: "a0000000-0000-0000-0000-000000000013",
  contradictionA: "a0000000-0000-0000-0000-000000000014",
  contradictionB: "a0000000-0000-0000-0000-000000000015",
  supersededA: "a0000000-0000-0000-0000-000000000016",
  supersededB: "a0000000-0000-0000-0000-000000000017",
} as const;


// ---------------------------------------------------------------------------
// Thought fixture rows
// ---------------------------------------------------------------------------

export interface EvalThought {
  id: string;
  raw_text: string;
  thought_type: "decision" | "insight" | "note" | "action";
  created_at: string;
  project: string | null;
  salience: number;
  supersedes_id: string | null;
  embedding: number[];
}

const NOW = "2026-07-12T12:00:00Z";

function daysAgo(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function buildThoughts(): EvalThought[] {
  return [
    {
      id: FIXTURE_UUIDS.freshDecisionAlpha1,
      raw_text: "Use pgvector ivfflat index for semantic search",
      thought_type: "decision",
      created_at: daysAgo(1),
      project: "alpha",
      salience: 4,
      supersedes_id: null,
      embedding: makeThoughtVector(0, FIXTURE_UUIDS.freshDecisionAlpha1, 0.15),
    },
    {
      id: FIXTURE_UUIDS.freshDecisionAlpha2,
      raw_text: "Adopt tsx for running TypeScript scripts in CI",
      thought_type: "decision",
      created_at: daysAgo(2),
      project: "alpha",
      salience: 3,
      supersedes_id: null,
      embedding: makeThoughtVector(0, FIXTURE_UUIDS.freshDecisionAlpha2, 0.20),
    },
    {
      id: FIXTURE_UUIDS.staleInsightAlpha1,
      raw_text: "Cosine similarity alone misses recency - stale top results mislead users",
      thought_type: "insight",
      created_at: daysAgo(320),
      project: "alpha",
      salience: 3,
      supersedes_id: null,
      embedding: makeThoughtVector(1, FIXTURE_UUIDS.staleInsightAlpha1, 0.15),
    },
    {
      id: FIXTURE_UUIDS.staleInsightAlpha2,
      raw_text: "Embedding cache hit rate degrades after 90d without refresh",
      thought_type: "insight",
      created_at: daysAgo(350),
      project: "alpha",
      salience: 2,
      supersedes_id: null,
      embedding: makeThoughtVector(1, FIXTURE_UUIDS.staleInsightAlpha2, 0.12),
    },
    {
      id: FIXTURE_UUIDS.freshDecisionBeta1,
      raw_text: "Beta service uses Redis for rate-limit counters",
      thought_type: "decision",
      created_at: daysAgo(5),
      project: "beta",
      salience: 4,
      supersedes_id: null,
      embedding: makeThoughtVector(2, FIXTURE_UUIDS.freshDecisionBeta1, 0.10),
    },
    {
      id: FIXTURE_UUIDS.freshDecisionBeta2,
      raw_text: "Enable WAL archiving for beta Postgres instance",
      thought_type: "decision",
      created_at: daysAgo(3),
      project: "beta",
      salience: 3,
      supersedes_id: null,
      embedding: makeThoughtVector(2, FIXTURE_UUIDS.freshDecisionBeta2, 0.18),
    },
    {
      id: FIXTURE_UUIDS.noteBeta1,
      raw_text: "Beta API endpoint inventory - 23 endpoints as of Q2",
      thought_type: "note",
      created_at: daysAgo(60),
      project: "beta",
      salience: 1,
      supersedes_id: null,
      embedding: makeThoughtVector(3, FIXTURE_UUIDS.noteBeta1, 0.25),
    },
    {
      id: FIXTURE_UUIDS.noteBeta2,
      raw_text: "Beta deployment checklist needs update for k8s changes",
      thought_type: "note",
      created_at: daysAgo(200),
      project: "beta",
      salience: 2,
      supersedes_id: null,
      embedding: makeThoughtVector(3, FIXTURE_UUIDS.noteBeta2, 0.20),
    },
    {
      id: FIXTURE_UUIDS.freshAction1,
      raw_text: "Review alpha project dependencies for security patches",
      thought_type: "action",
      created_at: daysAgo(1),
      project: "alpha",
      salience: 3,
      supersedes_id: null,
      embedding: makeThoughtVector(4, FIXTURE_UUIDS.freshAction1, 0.10),
    },
    {
      id: FIXTURE_UUIDS.freshAction2,
      raw_text: "Schedule beta load-testing session for next sprint",
      thought_type: "action",
      created_at: daysAgo(1),
      project: "beta",
      salience: 3,
      supersedes_id: null,
      embedding: makeThoughtVector(4, FIXTURE_UUIDS.freshAction2, 0.10),
    },
    {
      id: FIXTURE_UUIDS.oldSalientDecision,
      raw_text: "Adopt monorepo structure with npm workspaces",
      thought_type: "decision",
      created_at: daysAgo(400),
      project: "alpha",
      salience: 5,
      supersedes_id: null,
      embedding: makeThoughtVector(5, FIXTURE_UUIDS.oldSalientDecision, 0.08),
    },
    {
      id: FIXTURE_UUIDS.mediumAlphaNote1,
      raw_text: "Alpha CI pipeline takes 14 minutes end-to-end",
      thought_type: "note",
      created_at: daysAgo(90),
      project: "alpha",
      salience: 1,
      supersedes_id: null,
      embedding: makeThoughtVector(6, FIXTURE_UUIDS.mediumAlphaNote1, 0.20),
    },
    {
      id: FIXTURE_UUIDS.freshInsightBeta,
      raw_text: "Beta service benefits from connection pooling to Postgres",
      thought_type: "insight",
      created_at: daysAgo(7),
      project: "beta",
      salience: 4,
      supersedes_id: null,
      embedding: makeThoughtVector(7, FIXTURE_UUIDS.freshInsightBeta, 0.15),
    },
    {
      id: FIXTURE_UUIDS.contradictionA,
      raw_text: "Use in-process caching for hot paths in alpha",
      thought_type: "decision",
      created_at: daysAgo(10),
      project: "alpha",
      salience: 3,
      supersedes_id: null,
      embedding: makeThoughtVector(0, FIXTURE_UUIDS.contradictionA, 0.12),
    },
    {
      id: FIXTURE_UUIDS.contradictionB,
      raw_text: "Avoid in-process caching - use distributed Redis instead",
      thought_type: "decision",
      created_at: daysAgo(5),
      project: "alpha",
      salience: 4,
      supersedes_id: null,
      embedding: makeThoughtVector(0, FIXTURE_UUIDS.contradictionB, 0.12),
    },
    {
      id: FIXTURE_UUIDS.supersededA,
      raw_text: "Use knex for database migrations",
      thought_type: "decision",
      created_at: daysAgo(100),
      project: "alpha",
      salience: 3,
      supersedes_id: null,
      embedding: makeThoughtVector(1, FIXTURE_UUIDS.supersededA, 0.15),
    },
    {
      id: FIXTURE_UUIDS.supersededB,
      raw_text: "Use supabase js migrations instead of knex",
      thought_type: "decision",
      created_at: daysAgo(30),
      project: "alpha",
      salience: 4,
      supersedes_id: FIXTURE_UUIDS.supersededA,
      embedding: makeThoughtVector(1, FIXTURE_UUIDS.supersededB, 0.15),
    },
  ];
}


// ---------------------------------------------------------------------------
// Golden queries
// ---------------------------------------------------------------------------

export interface GoldenQuery {
  id: string;
  query_text: string;
  description: string;
  embedding: number[];
  expected_thought_ids: string[];
  min_recall_at_5: number;
  min_recall_at_10: number;
  params?: Record<string, unknown>;
}

function buildGoldenQueries(): GoldenQuery[] {
  const u = FIXTURE_UUIDS;

  // Analytical v2 score derivation (migration 009 formula):
  // score = cosine_sim * GREATEST(exp(-ln2*age/(halflife*type_mult)),0.05) * (0.7+salience*0.1) * (0.7 if contradiction)
  // type_mult = 2.0 for decision/insight (60d), 1.0 for note/action (30d)
  // cosine_sim ~1 same-cluster, ~0 cross-cluster
  //
  // Cluster 0 scores: freshDecisionAlpha1=1.087, freshDecisionAlpha2=0.977, contradictionB=0.727, contradictionA=0.624
  // Cluster 1: supersededB=0.778, staleInsightAlpha1=0.050, staleInsightAlpha2=0.045
  // Cluster 5: oldSalientDecision=0.060
  // Cluster 7: freshInsightBeta=1.015

  return [
    {
      id: "q-fresh-alpha-decision",
      query_text: "pgvector index decision search",
      description: "Centroid-0: fresh decisions rank by v2 score.",
      embedding: makeQueryVector(0),
      expected_thought_ids: [
        u.freshDecisionAlpha1,
        u.freshDecisionAlpha2,
        u.contradictionB,
        u.contradictionA,
      ],
      min_recall_at_5: 1.0,
      min_recall_at_10: 1.0,
    },
    {
      id: "q-contradiction-demotion",
      query_text: "caching strategies decisions",
      description: "Centroid-0: contradicted below non-contradicted.",
      embedding: makeQueryVector(0),
      expected_thought_ids: [
        u.freshDecisionAlpha1,
        u.freshDecisionAlpha2,
        u.contradictionB,
        u.contradictionA,
      ],
      min_recall_at_5: 1.0,
      min_recall_at_10: 1.0,
    },
    {
      id: "q-superseded-exclusion",
      query_text: "database migration tools evaluation",
      description: "Centroid-1: supersededA excluded.",
      embedding: makeQueryVector(1),
      expected_thought_ids: [
        u.supersededB,
        u.staleInsightAlpha1,
        u.staleInsightAlpha2,
      ],
      min_recall_at_5: 1.0,
      min_recall_at_10: 1.0,
    },
    {
      id: "q-recency-floor",
      query_text: "monorepo structure decision",
      description: "Centroid-5: 400-day-old decision reachable.",
      embedding: makeQueryVector(5),
      expected_thought_ids: [u.oldSalientDecision],
      min_recall_at_5: 0.0,
      min_recall_at_10: 1.0,
    },
    {
      id: "q-project-filter-alpha",
      query_text: "alpha project decisions and notes",
      description: "Centroid-0 + filter_project=alpha.",
      embedding: makeQueryVector(0),
      expected_thought_ids: [
        u.freshDecisionAlpha1,
        u.freshDecisionAlpha2,
        u.contradictionB,
        u.contradictionA,
      ],
      min_recall_at_5: 1.0,
      min_recall_at_10: 1.0,
      params: { filter_project: "alpha" },
    },
    {
      id: "q-fresh-insight-beta",
      query_text: "connection pooling postgres insight",
      description: "Centroid-7: fresh insight, beta.",
      embedding: makeQueryVector(7),
      expected_thought_ids: [u.freshInsightBeta],
      min_recall_at_5: 1.0,
      min_recall_at_10: 1.0,
    },
  ];
}

export const EVAL_THOUGHTS: EvalThought[] = buildThoughts();
export const GOLDEN_QUERIES: GoldenQuery[] = buildGoldenQueries();
export const CONTRADICTION_PAIR: [string, string] = [
  FIXTURE_UUIDS.contradictionA,
  FIXTURE_UUIDS.contradictionB,
];
export const ALL_PROJECTS: string[] = ["alpha", "beta"];

export function getThoughtById(id: string): EvalThought | undefined {
  return EVAL_THOUGHTS.find((t) => t.id === id);
}
