#!/usr/bin/env node
/**
 * Seed eval fixture data into Supabase.
 *
 * Idempotent: upserts on fixed UUIDs so it's safe to run repeatedly.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... tsx src/eval/seed-eval-data.ts
 *
 * Exit codes:
 *   0 - data seeded successfully (or already up-to-date)
 *   1 - missing env vars, missing v0.5 columns, or supabase error
 */

import { createClient } from "@supabase/supabase-js";
import { EVAL_THOUGHTS, FIXTURE_UUIDS } from "./fixtures.js";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  // -----------------------------------------------------------------------
  // Detect whether v0.5 columns exist (project, salience, supersedes_id)
  // -----------------------------------------------------------------------
  const { error: colCheck } = await supabase
    .from("thoughts")
    .select("project, salience, supersedes_id")
    .limit(1);

  if (colCheck && colCheck.message && colCheck.message.includes("column")) {
    console.error(
      "v0.5 columns (project, salience, supersedes_id) not found in thoughts table. " +
      "Please apply migrations 008 and 009 before seeding eval data.",
    );
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Upsert each fixture thought
  // -----------------------------------------------------------------------
  console.log("Seeding %d eval thoughts...", EVAL_THOUGHTS.length);

  for (const thought of EVAL_THOUGHTS) {
    const { error } = await supabase.from("thoughts").upsert(
      {
        id: thought.id,
        raw_text: thought.raw_text,
        thought_type: thought.thought_type,
        created_at: thought.created_at,
        project: thought.project,
        salience: thought.salience,
        supersedes_id: thought.supersedes_id,
        embedding: thought.embedding,
      },
      { onConflict: "id" },
    );

    if (error) {
      console.error("Failed to upsert thought %s: %s", thought.id, error.message);
      process.exit(1);
    }
  }

  // -----------------------------------------------------------------------
  // Seed contradiction entry (if your app stores contradictions separately)
  // -----------------------------------------------------------------------
  const { error: contradictionError } = await supabase
    .from("contradictions")
    .upsert(
      {
        thought_a_id: FIXTURE_UUIDS.contradictionA,
        thought_b_id: FIXTURE_UUIDS.contradictionB,
        reason: "eval fixture - contradictory caching strategies",
        status: "open",
        severity: 4,
        confidence: 0.9,
        embedding_model: "text-embedding-3-small",
      },
      { onConflict: "LEAST(thought_a_id, thought_b_id), GREATEST(thought_a_id, thought_b_id)" },
    );

  if (contradictionError && !contradictionError.message.includes("does not exist")) {
    // contradictions table might not exist yet — that's OK
    console.warn("Warning: could not seed contradiction: %s", contradictionError.message);
  }

  console.log("Eval data seeded successfully.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
