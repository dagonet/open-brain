// run-nightly-jobs edge function
//
// Nightly maintenance routine for Open Brain. Runs as a scheduled Supabase
// edge function via pg_cron (see docs/cron-setup.sql). Reports on system
// health and checks OpenAI API usage against budget caps.
//
// Inspired by Andrej Karpathy's LLM Wiki gist
//   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
// via Nate B Jones
//   https://www.youtube.com/watch?v=dxq7WtWxi44

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

interface JobReport {
  success: boolean;
  timestamp: string;
  stats: SystemStats;
  budget: BudgetInfo;
  maintenance: MaintenanceActions;
}

interface SystemStats {
  total_thoughts: number;
  thoughts_today: number;
  thoughts_this_week: number;
  thoughts_this_month: number;
  active_thoughts: number;
  deleted_thoughts: number;
  open_contradictions: number;
  resolved_contradictions: number;
  stale_wiki_pages: number;
  unprocessed_thoughts: number;
  total_wiki_pages: number;
  projects: string[];
}

interface BudgetInfo {
  estimated_monthly_cost: number;
  monthly_budget: number;
  budget_used_pct: number;
  warn_threshold: number;
  over_budget: boolean;
  near_limit: boolean;
}

interface MaintenanceActions {
  backfill_verified: boolean;
  backfill_pending_count: number;
  notes: string[];
}

function getMonthlyBudget(): number {
  const raw = Deno.env.get("OPEN_BRAIN_MONTHLY_BUDGET_USD");
  const val = Number(raw);
  return Number.isFinite(val) && val > 0 ? val : 50;
}

function getWarnThreshold(): number {
  const raw = Deno.env.get("OPEN_BRAIN_WARN_THRESHOLD");
  const val = Number(raw);
  return Number.isFinite(val) && val > 0 && val <= 1 ? val : 0.8;
}

async function collectStats(supabase: any): Promise<SystemStats> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [totalR, todayR, weekR, monthR, activeR, deletedR] = await Promise.all([
    supabase.from("thoughts").select("*", { count: "exact", head: true }),
    supabase.from("thoughts").select("*", { count: "exact", head: true }).gte("created_at", todayStart),
    supabase.from("thoughts").select("*", { count: "exact", head: true }).gte("created_at", weekStart),
    supabase.from("thoughts").select("*", { count: "exact", head: true }).gte("created_at", monthStart),
    supabase.from("thoughts").select("*", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("thoughts").select("*", { count: "exact", head: true }).not("deleted_at", "is", null),
  ]);

  const [contraOpen, contraResolved, stalePages, unprocessed, totalWiki, projects] = await Promise.all([
    supabase.from("contradictions").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("contradictions").select("*", { count: "exact", head: true }).in("status", ["resolved", "ignored", "false_positive"]),
    supabase.from("wiki_page_staleness").select("*", { count: "exact", head: true }).gt("stale_since_n_thoughts", 0),
    supabase.from("thoughts").select("*", { count: "exact", head: true }).eq("processing_status", "pending"),
    supabase.from("wiki_pages").select("*", { count: "exact", head: true }),
    supabase.from("thoughts").select("project").not("project", "is", null).is("deleted_at", null),
  ]);

  const projectSet = new Set<string>();
  for (const row of (projects.data ?? []) as Array<{ project: string }>) {
    if (row.project) projectSet.add(row.project);
  }

  return {
    total_thoughts: totalR.count ?? 0,
    thoughts_today: todayR.count ?? 0,
    thoughts_this_week: weekR.count ?? 0,
    thoughts_this_month: monthR.count ?? 0,
    active_thoughts: activeR.count ?? 0,
    deleted_thoughts: deletedR.count ?? 0,
    open_contradictions: contraOpen.count ?? 0,
    resolved_contradictions: contraResolved.count ?? 0,
    stale_wiki_pages: stalePages.count ?? 0,
    unprocessed_thoughts: unprocessed.count ?? 0,
    total_wiki_pages: totalWiki.count ?? 0,
    projects: [...projectSet].sort(),
  };
}

function estimateCost(stats: SystemStats): number {
  const perThought = 0.00043;
  const perContra = 0.00086;
  const perWiki = 0.01;
  return (stats.thoughts_this_month * perThought)
       + (stats.open_contradictions * perContra)
       + (Math.min(stats.stale_wiki_pages, 10) * perWiki);
}

async function verifyBackfill(supabase: any): Promise<object> {
  const { count: pending } = await supabase
    .from("thoughts")
    .select("*", { count: "exact", head: true })
    .not("metadata->>project", "is", null)
    .is("project", null)
    .is("deleted_at", null);

  return {
    verified: (pending?.count ?? 0) === 0,
    pending_count: pending?.count ?? 0,
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ success: false, error: "Missing env vars" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const startTime = Date.now();
  const notes: string[] = [];

  const stats = await collectStats(supabase);
  console.log("run-nightly-jobs: stats", JSON.stringify(stats));

  const monthlyBudget = getMonthlyBudget();
  const warnThreshold = getWarnThreshold();
  const estimatedMonthlyCost = estimateCost(stats);
  const budgetUsedPct = monthlyBudget > 0
    ? Math.round((estimatedMonthlyCost / monthlyBudget) * 10000) / 100
    : 0;

  if (budgetUsedPct >= warnThreshold * 100) {
    notes.push("Budget warning: " + budgetUsedPct + "% of $" + monthlyBudget + " used");
  }
  if (estimatedMonthlyCost >= monthlyBudget) {
    notes.push("CRITICAL: Estimated cost exceeds monthly budget");
  }
  if (stats.unprocessed_thoughts > 0) {
    notes.push("Unprocessed thoughts: " + stats.unprocessed_thoughts);
  }
  if (stats.open_contradictions > 10) {
    notes.push("High open contradictions: " + stats.open_contradictions);
  }
  if (stats.stale_wiki_pages > 0) {
    notes.push("Stale wiki pages: " + stats.stale_wiki_pages);
  }

  const backfillResult = await verifyBackfill(supabase);
  if (!backfillResult.verified) {
    notes.push("Backfill incomplete: " + backfillResult.pending_count + " rows remaining.");
  }

  const report: JobReport = {
    success: true,
    timestamp: new Date().toISOString(),
    stats,
    budget: {
      estimated_monthly_cost: Math.round(estimatedMonthlyCost * 100) / 100,
      monthly_budget: monthlyBudget,
      budget_used_pct: budgetUsedPct,
      warn_threshold: warnThreshold,
      over_budget: estimatedMonthlyCost >= monthlyBudget,
      near_limit: budgetUsedPct >= warnThreshold * 100,
    },
    maintenance: {
      backfill_verified: backfillResult.verified,
      backfill_pending_count: backfillResult.pending_count,
      notes,
    },
  };

  console.log("run-nightly-jobs: complete", JSON.stringify({
    duration_ms: Date.now() - startTime,
    ...report,
  }));

  return new Response(JSON.stringify(report), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
