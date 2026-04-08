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
      '  brain "<your thought>"              Capture a single thought',
      '  brain import <file> [options]       Import memories from a file',
      '  brain sync-vault <path> [options]  Export thoughts as Obsidian markdown',
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
    ].join("\n"),
  );
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
