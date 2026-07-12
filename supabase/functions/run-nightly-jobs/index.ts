// run-nightly-jobs edge function
//
// Orchestrator: dispatches to sibling edge functions based on job type.
//   POST {job: "contradictions"} -> invokes detect-contradictions
//   POST {job: "stale-wiki"}     -> invokes compile-wiki per stale page
//
// Requires service-role bearer auth. Capped by MAX_LLM_CALLS_PER_JOB.
//
// Inspired by Andrej Karpathy's LLM Wiki gist
//   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
// via Nate B Jones
//   https://www.youtube.com/watch?v=dxq7WtWxi44

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Types

interface StalePageRow {
  slug: string;
  stale_since_n_thoughts: number;
  compiled_at: string | null;
}

interface ActionResult {
  action: string;
  status: "ok" | "error";
  detail: string;
}

interface JobSummary {
  job: string;
  actions_taken: number;
  budget_spent: number;
  budget_remaining: number;
  errors: number;
  results: ActionResult[];
}

// Helpers

function envInt(key: string, defaultVal: number): number {
  const raw = (Deno.env.get(key) ?? "").trim();
  if (raw === "") return defaultVal;
  const val = Number(raw);
  return Number.isFinite(val) && val >= 0 ? val : defaultVal;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Handler

serve(async (req: Request): Promise<Response> => {
  // Auth guard — require service-role bearer
  const auth = req.headers.get("Authorization") ?? "";
  const svcRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== svcRole) {
    return json(401, { error: "Unauthorized" });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  // Parse job
  let job: string;
  try {
    const body = await req.json();
    job = body.job;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  if (job !== "contradictions" && job !== "stale-wiki") {
    return json(400, { error: 'Unknown job: "' + job + '". Must be "contradictions" or "stale-wiki"' });
  }

  const budget = envInt("MAX_LLM_CALLS_PER_JOB", 50);
  const authHeaders = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + serviceKey,
  };

  const summary = job === "contradictions"
    ? await runContradictions(supabaseUrl, authHeaders, budget)
    : await runStaleWiki(supabaseUrl, authHeaders, budget, serviceKey);

  console.log("run-nightly-jobs:", JSON.stringify(summary));
  return json(200, summary);
});

// Job: contradictions

async function runContradictions(
  supabaseUrl: string,
  headers: Record<string, string>,
  budget: number,
): Promise<JobSummary> {
  const limit = envInt("NIGHTLY_CONTRADICTION_LIMIT", 100);
  // Conservative over-count: reserve full candidate_limit against budget
  // though actual LLM usage may be lower (not every candidate produces a
  // judged pair). This guarantees the hard stop is never exceeded.
  const candidates = Math.min(limit, budget);
  const results: ActionResult[] = [];

  try {
    const res = await fetch(supabaseUrl + "/functions/v1/detect-contradictions", {
      method: "POST",
      headers,
      body: JSON.stringify({ candidate_limit: candidates }),
    });

    if (!res.ok) {
      results.push({
        action: "detect-contradictions",
        status: "error",
        detail: "HTTP " + res.status + ": " + (await res.text()),
      });
    } else {
      const data = await res.json() as Record<string, unknown>;
      const inserted = data.contradictions_inserted ?? "?";
      const judged = data.pairs_judged ?? "?";
      const scanned = data.candidates_scanned ?? "?";
      const errs = data.errors ?? "?";
      results.push({
        action: "detect-contradictions",
        status: "ok",
        detail: "inserted=" + inserted + ", judged=" + judged + ", scanned=" + scanned + ", errors=" + errs,
      });
    }
  } catch (err: unknown) {
    results.push({
      action: "detect-contradictions",
      status: "error",
      detail: String(err),
    });
  }

  return {
    job: "contradictions",
    actions_taken: results.filter(function (r) { return r.status === "ok"; }).length,
    budget_spent: candidates,
    budget_remaining: Math.max(0, budget - candidates),
    errors: results.filter(function (r) { return r.status === "error"; }).length,
    results,
  };
}

// Job: stale-wiki

async function runStaleWiki(
  supabaseUrl: string,
  headers: Record<string, string>,
  budget: number,
  serviceKey: string,
): Promise<JobSummary> {
  const compileBudget = envInt("NIGHTLY_COMPILE_BUDGET", 5);
  const maxPages = Math.min(compileBudget, budget);
  const results: ActionResult[] = [];

  // Fetch stale pages via REST API (avoids supabase-js esm.sh import)
  let stalePages: StalePageRow[];
  try {
    stalePages = await queryStalePages(supabaseUrl, serviceKey, maxPages);
  } catch (err: unknown) {
    results.push({
      action: "query-wiki_page_staleness",
      status: "error",
      detail: String(err),
    });
    return {
      job: "stale-wiki",
      actions_taken: 0,
      budget_spent: 0,
      budget_remaining: budget,
      errors: 1,
      results,
    };
  }

  let budgetSpent = 0;

  for (const page of stalePages) {
    if (budgetSpent >= budget) break;

    try {
      const res = await fetch(supabaseUrl + "/functions/v1/compile-wiki", {
        method: "POST",
        headers,
        body: JSON.stringify({ slug: page.slug, dry_run: false }),
      });

      if (!res.ok) {
        results.push({
          action: "compile-wiki:" + page.slug,
          status: "error",
          detail: "HTTP " + res.status + ": " + (await res.text()),
        });
      } else {
        const data = await res.json() as Record<string, unknown>;
        const version = data.version ?? "?";
        const partial = data.partial ?? "?";
        const cited = data.cited ?? "?";
        const sourceCount = data.source_thought_count ?? "?";
        results.push({
          action: "compile-wiki:" + page.slug,
          status: "ok",
          detail: "version=" + version + ", partial=" + partial + ", cited=" + cited + ", sources=" + sourceCount,
        });
      }
    } catch (err: unknown) {
      results.push({
        action: "compile-wiki:" + page.slug,
        status: "error",
        detail: String(err),
      });
    }

    budgetSpent++;
  }

  return {
    job: "stale-wiki",
    actions_taken: results.filter(function (r) { return r.status === "ok"; }).length,
    budget_spent: budgetSpent,
    budget_remaining: Math.max(0, budget - budgetSpent),
    errors: results.filter(function (r) { return r.status === "error"; }).length,
    results,
  };
}

// REST query helper

async function queryStalePages(
  supabaseUrl: string,
  serviceKey: string,
  limit: number,
): Promise<StalePageRow[]> {
  const url = new URL(supabaseUrl + "/rest/v1/wiki_page_staleness");
  url.searchParams.set("select", "slug,stale_since_n_thoughts,compiled_at");
  url.searchParams.set("stale_since_n_thoughts", "gt.5");
  url.searchParams.set("order", "stale_since_n_thoughts.desc");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    headers: {
      "Authorization": "Bearer " + serviceKey,
      "apikey": serviceKey,
    },
  });
  if (!res.ok) throw new Error("REST " + res.status + ": " + (await res.text()));
  return await res.json();
}
