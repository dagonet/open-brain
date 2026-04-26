#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID, createHash } from "node:crypto";

interface Config {
  api_url: string;
  api_key: string;
}

interface ThoughtResponse {
  success: boolean;
  error?: string;
  thought?: {
    thought_type: string | null;
    people: string[];
    topics: string[];
    action_items: string[];
  };
  is_duplicate?: boolean;
}

function loadConfig(): Config | null {
  // 1. Environment variables
  const envUrl = process.env.BRAIN_API_URL;
  const envKey = process.env.BRAIN_API_KEY;
  if (envUrl && envKey) {
    return { api_url: envUrl, api_key: envKey };
  }

  // 2. Config file ~/.brain/config.json
  try {
    const configPath = join(homedir(), ".brain", "config.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as { api_url?: string; api_key?: string };
    if (parsed.api_url && parsed.api_key) {
      return { api_url: parsed.api_url, api_key: parsed.api_key };
    }
  } catch {
    // Config file not found or invalid
  }

  return null;
}

function printSetupInstructions(): void {
  console.error(
    [
      "",
      "Open Brain CLI - Setup Required",
      "",
      "Configure via environment variables:",
      '  export BRAIN_API_URL="https://<project>.supabase.co/functions/v1/capture-thought"',
      '  export BRAIN_API_KEY="<your-supabase-anon-key>"',
      "",
      "Or create ~/.brain/config.json:",
      "  {",
      '    "api_url": "https://<project>.supabase.co/functions/v1/capture-thought",',
      '    "api_key": "<your-supabase-anon-key>"',
      "  }",
      "",
    ].join("\n"),
  );
}

function printUsage(): void {
  console.error(
    [
      'Usage:',
      '  brain "<your thought>"               Capture a single thought',
      '  brain import <file> [options]        Import memories from a file',
      '  brain sync-vault <path> [options]    Export thoughts as Obsidian markdown',
      '  brain audit [options]                Audit recent thoughts for contradictions',
      '  brain wiki <subcommand> [options]    Manage wiki pages (get|list|refresh|reject)',
      "",
      "Example:",
      '  brain "Met with Sarah today, she\'s considering consulting"',
      "",
      "Import options:",
      '  --source <name>    Source tag (default: "import")',
      '                     Use "import-claude" or "import-chatgpt" for provenance',
      "  --delay <ms>       Delay between API calls in ms (default: 500)",
      "  --dry-run          Parse and preview without importing",
      "",
      "Sync-vault options:",
      "  --dry-run          Preview changes without writing files",
      "",
      "Audit options:",
      "  --since <iso>      Only consider thoughts created at or after this timestamp",
      "  --topic <slug>     (Reserved) Restrict candidates to this topic slug",
      "  --candidate-limit  Max candidate thoughts to scan (default: 50)",
      "  --resolve <id>     Resolve a contradiction by id (requires --decision)",
      "  --decision <kind>  Decision: resolved | ignored | false_positive",
      "  --note <text>      Optional explanation captured into the audit thought",
      "  --verbose          Print per-row detail in addition to the summary",
      "",
      "Wiki subcommands:",
      "  brain wiki get <slug>                Print the latest compiled page",
      "  brain wiki list [--limit N]          List compiled pages, newest first",
      "  brain wiki refresh <slug>            Recompile the page for <slug>",
      "  brain wiki refresh --all             Recompile top topics by thought count",
      "  brain wiki refresh --dry-run ...     Print what would be compiled",
      "  brain wiki reject <page_id> --reason <text>",
      "                                       Reject a page; feedback nudges next compile",
      "",
    ].join("\n"),
  );
}

export function deriveFunctionsBase(apiUrl: string): string {
  const match = apiUrl.match(/^(https:\/\/[a-z0-9-]+\.supabase\.co)\/functions\/v1\//);
  if (!match) {
    throw new Error(
      'Cannot derive functions base from BRAIN_API_URL. Expected format: https://<ref>.supabase.co/functions/v1/...',
    );
  }
  return match[1] + "/functions/v1";
}

function formatConfirmation(thought: ThoughtResponse["thought"]): string {
  if (!thought) return "";
  const lines: string[] = [];
  if (thought.thought_type) {
    lines.push("  Type: " + thought.thought_type);
  }
  if (thought.people.length > 0) {
    lines.push("  People: " + thought.people.join(", "));
  }
  if (thought.topics.length > 0) {
    lines.push("  Topics: " + thought.topics.join(", "));
  }
  for (const item of thought.action_items) {
    lines.push("  Action: " + item);
  }
  return lines.join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importMemories(): Promise<void> {
  const args = process.argv.slice(3);

  // Parse arguments
  let filePath: string | undefined;
  let source = "import";
  let delay = 500;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && i + 1 < args.length) {
      source = args[++i];
    } else if (args[i] === "--delay" && i + 1 < args.length) {
      delay = parseInt(args[++i], 10);
      if (isNaN(delay) || delay < 0) {
        console.error("Error: --delay must be a non-negative number");
        process.exit(1);
      }
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (!filePath) {
      filePath = args[i];
    } else {
      console.error("Error: unexpected argument: " + args[i]);
      printUsage();
      process.exit(1);
    }
  }

  if (!filePath) {
    console.error("Error: file path is required for import");
    printUsage();
    process.exit(1);
  }

  const config = loadConfig();
  if (!config && !dryRun) {
    printSetupInstructions();
    process.exit(1);
  }

  // Read and parse file
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error reading file: " + message);
    process.exit(1);
  }

  const datePrefix = /^\[(\d{4}-\d{2}-\d{2})\]\s*-?\s*/;
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);

  if (lines.length === 0) {
    console.error("No memories found in file.");
    process.exit(1);
  }

  console.log(`Found ${lines.length} memories in ${filePath}`);
  if (dryRun) {
    console.log("(dry run — no changes will be made)\n");
  }

  let captured = 0;
  let skipped = 0;
  let failed = 0;
  const padWidth = String(lines.length).length;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const idx = String(i + 1).padStart(padWidth);
    const prefix = `[${idx}/${lines.length}]`;

    // Strip date prefix if present
    let metadata: Record<string, unknown> | undefined;
    const dateMatch = line.match(datePrefix);
    if (dateMatch) {
      metadata = { original_date: dateMatch[1] };
      line = line.slice(dateMatch[0].length).trim();
    }

    if (line.length === 0) continue;

    const idempotency_key = createHash("sha256")
      .update(source + ":" + line.trim().toLowerCase())
      .digest("hex");

    const preview = line.length > 50 ? line.slice(0, 50) + "..." : line;

    if (dryRun) {
      const dateTag = metadata?.original_date ? ` [${metadata.original_date}]` : "";
      console.log(`${prefix} ${preview}${dateTag}`);
      captured++;
      continue;
    }

    try {
      const response = await fetch(config!.api_url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config!.api_key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: line, source, idempotency_key, metadata }),
      });

      const data = (await response.json()) as ThoughtResponse;

      if (!response.ok || !data.success) {
        const msg = data.error || "HTTP " + response.status;
        console.log(`${prefix} \u2717 Failed: ${msg}`);
        failed++;
      } else if (data.is_duplicate) {
        console.log(`${prefix} \u223C Skipped (duplicate): "${preview}"`);
        skipped++;
      } else {
        console.log(`${prefix} \u2713 Captured: "${preview}"`);
        captured++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`${prefix} \u2717 Failed: ${message}`);
      failed++;
    }

    if (delay > 0 && i < lines.length - 1) {
      await sleep(delay);
    }
  }

  console.log(`\nDone: ${captured} captured, ${skipped} skipped, ${failed} failed`);
}

async function captureSingleThought(text: string): Promise<void> {
  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }

  const idempotency_key = randomUUID();

  try {
    const response = await fetch(config.api_url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.api_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        source: "cli",
        idempotency_key,
      }),
    });

    if (response.status === 401 || response.status === 403) {
      console.error(
        "\u2717 Failed to capture thought: Authentication failed. Check your BRAIN_API_KEY.",
      );
      process.exit(1);
    }

    if (response.status >= 500) {
      console.error(
        "\u2717 Failed to capture thought: Server error. Please try again later.",
      );
      process.exit(1);
    }

    const data = (await response.json()) as ThoughtResponse;

    if (!response.ok || !data.success) {
      const msg = data.error || "HTTP " + response.status;
      console.error("\u2717 Failed to capture thought: " + msg);
      process.exit(1);
    }

    if (data.is_duplicate) {
      console.log("\u223C Duplicate thought (already captured)");
    } else {
      console.log("\u2713 Thought captured");
    }

    const details = formatConfirmation(data.thought);
    if (details) {
      console.log(details);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("fetch") || message.includes("ECONNREFUSED") || message.includes("ENOTFOUND")) {
      console.error(
        "\u2717 Failed to capture thought: Could not reach the API. Check your connection and BRAIN_API_URL.",
      );
    } else {
      console.error("\u2717 Failed to capture thought: " + message);
    }
    process.exit(1);
  }
}

// --- sync-vault types and helpers ---

interface Thought {
  id: string;
  raw_text: string;
  thought_type: string | null;
  people: string[];
  topics: string[];
  action_items: string[];
  action_items_resolved: boolean;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function derivePostgrestUrl(apiUrl: string): string {
  const match = apiUrl.match(/^(https:\/\/[a-z0-9-]+\.supabase\.co)\//);
  if (!match) {
    throw new Error(
      'Cannot derive PostgREST URL from BRAIN_API_URL. Expected format: https://<ref>.supabase.co/...',
    );
  }
  return match[1] + "/rest/v1/thoughts";
}

export function slugify(text: string, maxLen = 50): string {
  const firstLine = text.split(/\r?\n/)[0];
  const truncated = firstLine.slice(0, maxLen);
  return truncated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function thoughtToFilename(thought: Thought, usedNames?: Set<string>): string {
  const date = thought.created_at.slice(0, 10); // YYYY-MM-DD
  const slug = slugify(thought.raw_text);
  let base = `${date}-${slug}`;
  let filename = `${base}.md`;

  if (usedNames) {
    let suffix = 1;
    while (usedNames.has(filename)) {
      suffix++;
      filename = `${base}-${suffix}.md`;
    }
    usedNames.add(filename);
  }

  return filename;
}

export function computeTitle(rawText: string): string {
  const firstLine = rawText.split(/\r?\n/)[0];
  if (firstLine.length <= 80) return firstLine;
  return firstLine.slice(0, 80);
}

export function thoughtToMarkdown(thought: Thought): string {
  const title = computeTitle(thought.raw_text);
  const tags: string[] = [];
  if (thought.thought_type) {
    tags.push(`open-brain/${thought.thought_type}`);
  }
  for (const topic of thought.topics) {
    tags.push(topic);
  }

  const frontmatter: Record<string, unknown> = {
    id: thought.id,
    title,
    type: thought.thought_type || "note",
    people: thought.people,
    topics: thought.topics,
    source: thought.source,
    created: thought.created_at,
    updated: thought.updated_at,
  };
  if (thought.action_items.length > 0) {
    frontmatter.action_items = thought.action_items;
    frontmatter.action_items_resolved = thought.action_items_resolved;
  }
  frontmatter.tags = tags;

  const yamlLines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        yamlLines.push(`${key}: []`);
      } else {
        yamlLines.push(`${key}:`);
        for (const item of value) {
          yamlLines.push(`  - ${JSON.stringify(String(item))}`);
        }
      }
    } else if (typeof value === "boolean") {
      yamlLines.push(`${key}: ${value}`);
    } else {
      yamlLines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }
  yamlLines.push("---");

  let body = "\n" + thought.raw_text + "\n";

  if (thought.people.length > 0) {
    const wikilinks = thought.people
      .map((p) => `[[${p.charAt(0).toUpperCase() + p.slice(1)}]]`)
      .join(", ");
    body += `\n**People:** ${wikilinks}\n`;
  }

  return yamlLines.join("\n") + body;
}

async function fetchAllThoughts(
  postgrestUrl: string,
  apiKey: string,
): Promise<Thought[]> {
  const pageSize = 100;
  const allThoughts: Thought[] = [];
  let offset = 0;

  while (true) {
    const url =
      postgrestUrl +
      "?deleted_at=is.null&order=created_at.asc&select=id,raw_text,thought_type,people,topics,action_items,action_items_resolved,source,metadata,created_at,updated_at";

    const response = await fetch(url, {
      headers: {
        apikey: apiKey,
        Authorization: "Bearer " + apiKey,
        Range: `${offset}-${offset + pageSize - 1}`,
        Prefer: "count=exact",
      },
    });

    if (response.status === 416) {
      break; // Range not satisfiable — no more rows
    }

    if (!response.ok) {
      throw new Error(`PostgREST error: HTTP ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as Thought[];
    if (data.length === 0) {
      break;
    }

    allThoughts.push(...data);
    if (data.length < pageSize) {
      break; // Last page
    }
    offset += pageSize;
  }

  return allThoughts;
}

async function syncVault(): Promise<void> {
  const args = process.argv.slice(3);

  let vaultPath: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (!vaultPath) {
      vaultPath = args[i];
    } else {
      console.error("Error: unexpected argument: " + args[i]);
      printUsage();
      process.exit(1);
    }
  }

  if (!vaultPath) {
    console.error("Error: vault path is required for sync-vault");
    printUsage();
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }

  // Derive PostgREST URL
  let postgrestUrl: string;
  try {
    postgrestUrl = derivePostgrestUrl(config.api_url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  }

  // Validate vault path
  if (existsSync(vaultPath)) {
    const stat = statSync(vaultPath);
    if (!stat.isDirectory()) {
      console.error("Error: vault path exists but is not a directory: " + vaultPath);
      process.exit(1);
    }
  } else if (!dryRun) {
    mkdirSync(vaultPath, { recursive: true });
    console.log("Created vault directory: " + vaultPath);
  }

  // Fetch all thoughts
  console.log("Fetching thoughts from Open Brain...");
  let thoughts: Thought[];
  try {
    thoughts = await fetchAllThoughts(postgrestUrl, config.api_key);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("\u2717 Failed to fetch thoughts: " + message);
    process.exit(1);
  }

  if (thoughts.length === 0) {
    console.log("No thoughts found in Open Brain.");
    return;
  }

  console.log(`Found ${thoughts.length} thoughts`);
  if (dryRun) {
    console.log("(dry run \u2014 no files will be written)\n");
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const usedNames = new Set<string>();
  const currentFilenames = new Set<string>();

  for (const thought of thoughts) {
    const filename = thoughtToFilename(thought, usedNames);
    currentFilenames.add(filename);
    const markdown = thoughtToMarkdown(thought);
    const newHash = createHash("sha256").update(markdown).digest("hex");
    const filePath = join(vaultPath, filename);

    // Check existing file
    let existingHash: string | null = null;
    try {
      const existing = readFileSync(filePath, "utf-8");
      existingHash = createHash("sha256").update(existing).digest("hex");
    } catch {
      // File doesn't exist
    }

    if (existingHash === newHash) {
      unchanged++;
      continue;
    }

    const isNew = existingHash === null;
    const preview = computeTitle(thought.raw_text);
    const previewTrunc = preview.length > 50 ? preview.slice(0, 50) + "..." : preview;
    const symbol = isNew ? "\u2713" : "\u223C";
    const label = isNew ? "new" : "updated";

    console.log(`  ${symbol} [${label}] ${filename}: ${previewTrunc}`);

    if (!dryRun) {
      try {
        writeFileSync(filePath, markdown, "utf-8");
        if (isNew) created++;
        else updated++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  \u2717 Failed to write ${filename}: ${message}`);
        failed++;
      }
    } else {
      if (isNew) created++;
      else updated++;
    }
  }

  // Clean up old UUID-based filenames
  let cleaned = 0;
  const oldPattern = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.md$/;
  if (!dryRun && existsSync(vaultPath)) {
    try {
      const files = readdirSync(vaultPath);
      for (const file of files) {
        if (oldPattern.test(file) && !currentFilenames.has(file)) {
          try {
            unlinkSync(join(vaultPath, file));
            cleaned++;
          } catch {
            // Ignore individual file deletion errors
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  } else if (dryRun && existsSync(vaultPath)) {
    try {
      const files = readdirSync(vaultPath);
      for (const file of files) {
        if (oldPattern.test(file) && !currentFilenames.has(file)) {
          cleaned++;
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  const parts = [`${created} new`, `${updated} updated`, `${unchanged} unchanged`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (cleaned > 0) parts.push(`${cleaned} old files cleaned`);
  console.log("\nDone: " + parts.join(", "));
}

// --- audit command ---

interface ContradictionRow {
  id: string;
  thought_a_id: string;
  thought_b_id: string;
  reason: string;
  severity: number;
  confidence: number;
  status: string;
  detected_at: string;
}

async function postFunction(
  base: string,
  apiKey: string,
  functionName: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(`${base}/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

async function getFromPostgrest(
  apiUrl: string,
  apiKey: string,
  pathAndQuery: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const match = apiUrl.match(/^(https:\/\/[a-z0-9-]+\.supabase\.co)\//);
  if (!match) {
    throw new Error("Cannot derive PostgREST base from api_url");
  }
  const url = match[1] + "/rest/v1/" + pathAndQuery;
  const response = await fetch(url, {
    headers: {
      apikey: apiKey,
      Authorization: "Bearer " + apiKey,
    },
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

async function auditCommand(): Promise<void> {
  const args = process.argv.slice(3);
  let since: string | undefined;
  let topic: string | undefined;
  let candidateLimit: number | undefined;
  let verbose = false;
  let resolveId: string | undefined;
  let decision: string | undefined;
  let note: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--since" && i + 1 < args.length) {
      since = args[++i];
    } else if (a.startsWith("--since=")) {
      since = a.slice("--since=".length);
    } else if (a === "--topic" && i + 1 < args.length) {
      topic = args[++i];
    } else if (a.startsWith("--topic=")) {
      topic = a.slice("--topic=".length);
    } else if (a === "--candidate-limit" && i + 1 < args.length) {
      candidateLimit = parseInt(args[++i], 10);
    } else if (a.startsWith("--candidate-limit=")) {
      candidateLimit = parseInt(a.slice("--candidate-limit=".length), 10);
    } else if (a === "--resolve" && i + 1 < args.length) {
      resolveId = args[++i];
    } else if (a === "--decision" && i + 1 < args.length) {
      decision = args[++i];
    } else if (a === "--note" && i + 1 < args.length) {
      note = args[++i];
    } else if (a === "--verbose") {
      verbose = true;
    } else {
      console.error("Error: unexpected argument: " + a);
      printUsage();
      process.exit(1);
    }
  }

  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }

  const base = deriveFunctionsBase(config.api_url);

  if (resolveId) {
    if (!decision || !["resolved", "ignored", "false_positive"].includes(decision)) {
      console.error(
        "Error: --resolve requires --decision=resolved|ignored|false_positive",
      );
      process.exit(1);
    }
    const patch: Record<string, unknown> = {
      status: decision,
      resolved_at: new Date().toISOString(),
    };
    const match = config.api_url.match(/^(https:\/\/[a-z0-9-]+\.supabase\.co)\//);
    if (!match) {
      console.error("Error: cannot derive PostgREST base");
      process.exit(1);
    }
    const url = match[1] + "/rest/v1/contradictions?id=eq." + encodeURIComponent(resolveId);
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: config.api_key,
        Authorization: "Bearer " + config.api_key,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      console.error(`✗ Failed to resolve contradiction: HTTP ${response.status}`);
      process.exit(1);
    }
    console.log(`✓ Resolved ${resolveId} as ${decision}`);
    if (note) {
      console.log(`  Note: ${note}`);
    }
    return;
  }

  if (topic) {
    console.log(
      `(--topic ${topic} is currently advisory; the audit always scans by recency in v0.3.0)`,
    );
  }

  console.log("Running contradiction audit...");
  const { ok, status, data } = await postFunction(
    base,
    config.api_key,
    "detect-contradictions",
    {
      since,
      candidate_limit: candidateLimit,
    },
  );
  if (!ok) {
    const err = (data as { error?: string }).error || `HTTP ${status}`;
    console.error("✗ Audit failed: " + err);
    process.exit(1);
  }

  const summary = data as {
    candidates_scanned?: number;
    pairs_judged?: number;
    contradictions_inserted?: number;
    duplicates_skipped?: number;
    errors?: number;
  };
  console.log(
    `Done: candidates=${summary.candidates_scanned ?? 0} pairs=${
      summary.pairs_judged ?? 0
    } new=${summary.contradictions_inserted ?? 0} dup=${
      summary.duplicates_skipped ?? 0
    } errors=${summary.errors ?? 0}`,
  );

  if (verbose && (summary.contradictions_inserted ?? 0) > 0) {
    const since30 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const result = await getFromPostgrest(
      config.api_url,
      config.api_key,
      `contradictions?detected_at=gte.${encodeURIComponent(
        since30,
      )}&order=detected_at.desc&limit=20`,
    );
    if (result.ok) {
      const rows = result.data as ContradictionRow[];
      for (const row of rows) {
        const sevBadge = "*".repeat(Math.min(row.severity, 5));
        console.log(`  [${row.id}] ${sevBadge} (${row.confidence.toFixed(2)})`);
        console.log(`    ${row.thought_a_id} <-> ${row.thought_b_id}`);
        console.log(`    ${row.reason}`);
      }
    }
  }
}

// --- wiki command ---

interface CurrentWikiPageRow {
  id: string;
  slug: string;
  version: number;
  content_md: string;
  partial: boolean;
  source_thought_count: number;
  compiled_at: string;
}

interface TopicCountRow {
  slug: string;
  display_name: string;
  thought_count: number;
}

async function wikiGetCommand(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) {
    console.error("Error: brain wiki get <slug> requires a slug argument");
    process.exit(1);
  }
  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }
  const result = await getFromPostgrest(
    config.api_url,
    config.api_key,
    `current_wiki_pages?slug=eq.${encodeURIComponent(
      slug.toLowerCase(),
    )}&select=id,slug,version,content_md,partial,source_thought_count,compiled_at`,
  );
  if (!result.ok) {
    console.error(`✗ Failed: HTTP ${result.status}`);
    process.exit(1);
  }
  const rows = result.data as CurrentWikiPageRow[];
  if (rows.length === 0) {
    console.log(`No wiki page exists for "${slug}". Try: brain wiki refresh ${slug}`);
    return;
  }
  const page = rows[0];
  console.log(`# ${page.slug} (v${page.version})`);
  console.log(
    `Compiled ${page.compiled_at}; ${page.source_thought_count} sources${
      page.partial ? " (partial — some paragraphs were dropped)" : ""
    }\n`,
  );
  console.log(page.content_md);
}

async function wikiListCommand(args: string[]): Promise<void> {
  let limit = 50;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && i + 1 < args.length) {
      limit = parseInt(args[++i], 10);
    } else if (args[i].startsWith("--limit=")) {
      limit = parseInt(args[i].slice("--limit=".length), 10);
    }
  }
  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }
  const result = await getFromPostgrest(
    config.api_url,
    config.api_key,
    `current_wiki_pages?order=compiled_at.desc&limit=${limit}&select=slug,version,source_thought_count,partial,compiled_at`,
  );
  if (!result.ok) {
    console.error(`✗ Failed: HTTP ${result.status}`);
    process.exit(1);
  }
  const rows = result.data as CurrentWikiPageRow[];
  if (rows.length === 0) {
    console.log("(no wiki pages yet — run `brain wiki refresh --all`)");
    return;
  }
  for (const row of rows) {
    const partial = row.partial ? " [partial]" : "";
    console.log(
      `  v${row.version}  ${row.slug}  (${row.source_thought_count} sources, compiled ${row.compiled_at})${partial}`,
    );
  }
}

async function wikiRefreshCommand(args: string[]): Promise<void> {
  let slug: string | undefined;
  let all = false;
  let dryRun = false;
  let topK = 25;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--all") all = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--top" && i + 1 < args.length) topK = parseInt(args[++i], 10);
    else if (a.startsWith("--top=")) topK = parseInt(a.slice("--top=".length), 10);
    else if (!slug && !a.startsWith("--")) slug = a;
    else {
      console.error("Error: unexpected argument: " + a);
      process.exit(1);
    }
  }

  if (!all && !slug) {
    console.error("Error: brain wiki refresh requires <slug> or --all");
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }
  const base = deriveFunctionsBase(config.api_url);

  let slugs: string[];
  if (all) {
    const result = await getFromPostgrest(
      config.api_url,
      config.api_key,
      `topic_counts?order=thought_count.desc&limit=${topK}&select=slug,display_name,thought_count`,
    );
    if (!result.ok) {
      console.error(`✗ Failed to read topic_counts: HTTP ${result.status}`);
      process.exit(1);
    }
    const rows = result.data as TopicCountRow[];
    slugs = rows.filter((r) => r.thought_count >= 3).map((r) => r.slug);
    if (slugs.length === 0) {
      console.log("(no slugs with >=3 thoughts — nothing to compile)");
      return;
    }
    console.log(
      `Refreshing top ${slugs.length} slugs by thought count${dryRun ? " (dry run)" : ""}...`,
    );
  } else {
    slugs = [slug!.toLowerCase()];
  }

  let compiled = 0;
  let refused = 0;
  let raced = 0;
  let errors = 0;

  for (const s of slugs) {
    const { ok, data } = await postFunction(base, config.api_key, "compile-wiki", {
      slug: s,
      dry_run: dryRun,
    });
    if (!ok) {
      errors += 1;
      continue;
    }
    const status = (data as { status?: string }).status;
    if (status === "compiled" || status === "would_compile") {
      compiled += 1;
    } else if (status === "refused") {
      refused += 1;
    } else if (status === "raced") {
      raced += 1;
    }
  }

  console.log(
    `Done: compiled ${compiled}, refused ${refused}, raced ${raced}, errors ${errors}`,
  );
}

async function wikiRejectCommand(args: string[]): Promise<void> {
  const pageId = args[0];
  if (!pageId) {
    console.error("Error: brain wiki reject <page_id> requires a page id");
    process.exit(1);
  }
  let reason: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--reason" && i + 1 < args.length) {
      reason = args[++i];
    } else if (args[i].startsWith("--reason=")) {
      reason = args[i].slice("--reason=".length);
    }
  }
  if (!reason) {
    console.error("Error: --reason <text> is required");
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }

  const idempotency_key = randomUUID();
  const text = `Wiki page ${pageId} rejected: ${reason}`;
  const response = await fetch(config.api_url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.api_key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      source: "cli",
      idempotency_key,
      metadata: {
        kind: "wiki-feedback",
        page_id: pageId,
        decision: "invalidate",
      },
    }),
  });
  if (!response.ok) {
    console.error(`✗ Failed to record rejection: HTTP ${response.status}`);
    process.exit(1);
  }
  console.log(`✓ Recorded rejection for ${pageId}`);
}

async function wikiCommand(): Promise<void> {
  const sub = process.argv[3];
  const rest = process.argv.slice(4);
  switch (sub) {
    case "get":
      await wikiGetCommand(rest);
      return;
    case "list":
      await wikiListCommand(rest);
      return;
    case "refresh":
      await wikiRefreshCommand(rest);
      return;
    case "reject":
      await wikiRejectCommand(rest);
      return;
    default:
      console.error("Error: unknown wiki subcommand: " + (sub ?? "(none)"));
      printUsage();
      process.exit(1);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "import") {
    await importMemories();
    return;
  }

  if (command === "sync-vault") {
    await syncVault();
    return;
  }

  if (command === "audit") {
    await auditCommand();
    return;
  }

  if (command === "wiki") {
    await wikiCommand();
    return;
  }

  // Existing single-thought capture (command is the text)
  const text = command;
  if (!text) {
    printUsage();
    process.exit(1);
  }

  await captureSingleThought(text);
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("/brain.js") ||
    process.argv[1].endsWith("\\brain.js") ||
    process.argv[1].endsWith("/brain.ts") ||
    process.argv[1].endsWith("\\brain.ts"));

if (isMainModule) {
  main();
}
