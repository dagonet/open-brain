#!/usr/bin/env node
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  readdirSync,
  unlinkSync,
  realpathSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// Same approach as mcp-server/src/server.ts: ../package.json is cli/package.json
// from both src/ (tests) and dist/ (installed).
const require = createRequire(import.meta.url);
export const CLI_VERSION: string = (require('../package.json') as { version: string }).version;

interface Config {
  /** Anon key. No command sends it any more; kept optional for old configs. */
  api_key?: string;
  /** Service-role key; every command sends it (capture, import, sync-vault, wiki, audit). */
  service_key?: string;
  /** REST, functions and capture URLs, resolved once from `api_url` by loadConfig. */
  endpoints: ApiEndpoints;
}

interface ThoughtResponse {
  success: boolean;
  error?: string;
  thought?: {
    thought_type: string | null;
    people: string[];
    topics: string[];
    action_items: string[];
    project?: string | null;
  };
  is_duplicate?: boolean;
  duplicate_candidate?: {
    thought_id: string;
    raw_text_preview: string;
    similarity: number;
  };
}

interface ConfigFile {
  api_url?: string;
  api_key?: string;
  service_key?: string;
}

/** Reason behind a failed fetch: Node puts it in `err.cause` ("fetch failed" alone says nothing). */
function causeMessage(err: unknown): string | undefined {
  const cause = err instanceof Error ? err.cause : undefined;
  return cause instanceof Error && cause.message ? cause.message : undefined;
}

/** The error message, with the cause appended when there is one. */
function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause = causeMessage(err);
  return cause ? `${message} (${cause})` : message;
}

function readConfigFile(): ConfigFile {
  try {
    const configPath = join(homedir(), '.brain', 'config.json');
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf-8'));
    return parsed !== null && typeof parsed === 'object' ? (parsed as ConfigFile) : {};
  } catch {
    // Config file not found or invalid
    return {};
  }
}

export interface ApiEndpoints {
  /** URL of the capture-thought function (what `api_url` is used for in captures). */
  captureUrl: string;
  /** `<base>/functions/v1` */
  functionsBase: string;
  /** `<base>/rest/v1` */
  restBase: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Resolve the REST and function URLs from the configured API URL.
 *
 * Accepts a bare base (`https://<ref>.supabase.co`, `http://127.0.0.1:54321`, optional
 * trailing slash) or, for older configs, the capture-thought function URL
 * (`<base>/functions/v1/capture-thought`). Plain http is only accepted for loopback
 * (localhost, 127.0.0.1, [::1]), so a typo cannot send the service key unencrypted to a
 * remote host. `source` names where the value came from; error messages never contain the
 * value itself, since it may be a pasted secret or carry credentials.
 */
export function resolveApiEndpoints(apiUrl: string, source = 'API URL'): ApiEndpoints {
  let url: URL;
  try {
    url = new URL(String(apiUrl).trim());
  } catch {
    throw new Error(
      `Invalid API URL in ${source}. Expected a base URL such as https://<ref>.supabase.co or http://127.0.0.1:54321.`,
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(
      `Invalid API URL in ${source}: the scheme must be https (or http for loopback).`,
    );
  }
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Refusing API URL in ${source}: plain http to ${url.protocol}//${url.host} is not allowed (http only for localhost, 127.0.0.1 or [::1]). Use https.`,
    );
  }
  const path = url.pathname.replace(/\/+$/, '');
  const fn = path.match(/\/functions\/v1(\/.*)?$/);
  const prefix = fn ? path.slice(0, fn.index) : path;
  const root = url.origin + prefix;
  const functionsBase = root + '/functions/v1';
  return {
    captureUrl: functionsBase + (fn?.[1] || '/capture-thought'),
    functionsBase,
    restBase: root + '/rest/v1',
  };
}

export function loadConfig(): Config | null {
  // 1. Environment variables, 2. config file ~/.brain/config.json
  const file = readConfigFile();
  const apiUrl = process.env.BRAIN_API_URL || file.api_url;
  if (!apiUrl) return null;
  const source = process.env.BRAIN_API_URL ? 'BRAIN_API_URL' : 'api_url in ~/.brain/config.json';
  const endpoints = resolveApiEndpoints(apiUrl, source);
  const apiKey = process.env.BRAIN_API_KEY || file.api_key || undefined;

  // The service key is resolved on its own, however url/key were loaded:
  // BRAIN_SERVICE_KEY wins, then the config file's service_key.
  const service_key = process.env.BRAIN_SERVICE_KEY || file.service_key || undefined;
  return { api_key: apiKey, service_key, endpoints };
}

/**
 * compile-wiki, detect-contradictions and capture-thought accept the service-role
 * key only, and the database tables are closed to the anon key, so every command
 * that captures or reads/writes PostgREST needs a key separate from `api_key`.
 * Deliberately no fallback to the anon key: it would only produce a 401 / empty result.
 */
export function requireServiceKey(config: Pick<Config, 'service_key'>): string {
  if (!config.service_key) {
    throw new Error(
      'This command needs the service-role key. Set the BRAIN_SERVICE_KEY environment variable ' +
        'or the "service_key" field in ~/.brain/config.json.',
    );
  }
  return config.service_key;
}

function serviceKeyOrExit(config: Config): string {
  try {
    return requireServiceKey(config);
  } catch (err) {
    console.error('Error: ' + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

/**
 * One-line reason for a failed server call: HTTP status, the response's `error`
 * (or PostgREST `message`) field, and a key hint on 401/403.
 */
export function describeFailure(status: number, data: unknown): string {
  const body = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const detail =
    typeof body.error === 'string'
      ? body.error
      : typeof body.message === 'string'
        ? body.message
        : '';
  let reason = `HTTP ${status}` + (detail ? `: ${detail}` : '');
  if (status === 401 || status === 403) {
    reason += ' (check BRAIN_SERVICE_KEY / "service_key" in ~/.brain/config.json)';
  }
  return reason;
}

function printSetupInstructions(): void {
  console.error(
    [
      '',
      'Open Brain CLI - Setup Required',
      '',
      'Configure via environment variables:',
      '  export BRAIN_API_URL="https://<project>.supabase.co"',
      '  (local stack: http://127.0.0.1:54321; the older .../functions/v1/capture-thought form still works)',
      '',
      'Or create ~/.brain/config.json:',
      '  {',
      '    "api_url": "https://<project>.supabase.co",',
      '    "service_key": "<your-service-role-key>"',
      '  }',
      '',
      'Every command needs the service-role key (the legacy service_role JWT, eyJ...);',
      'the anon key is no longer accepted (or needed) by capture, import, sync-vault, audit or wiki:',
      '  export BRAIN_SERVICE_KEY="<your-service-role-key>"   (or "service_key" in config.json)',
      '',
    ].join('\n'),
  );
}

function isHelpFlag(arg: string | undefined): boolean {
  return arg === '--help' || arg === '-h';
}

/**
 * Reject an unknown dash-prefixed argument where a path is expected, instead of
 * treating it as a file or directory name. `./-name` is the way to name such a path.
 */
function rejectDashPath(arg: string, what: string): void {
  if (!arg.startsWith('-')) return;
  console.error(
    `Error: unknown option: ${arg} (${what}; to use a path that starts with a dash, write ./${arg})`,
  );
  printUsage();
  process.exit(1);
}

function printUsage(print: (message: string) => void = console.error): void {
  print(
    [
      'Usage:',
      '  brain "<your thought>" [options]     Capture a single thought',
      '  brain -- "<your thought>" [options]  Capture text that starts with a dash',
      '  brain import <file> [options]        Import memories from a file',
      '  brain sync-vault <path> [options]    Export thoughts as Obsidian markdown',
      '  brain audit [options]                Audit recent thoughts for contradictions',
      '  brain wiki <subcommand> [options]    Manage wiki pages (get|list|refresh|reject)',
      '  brain help | --help | -h             Show this help',
      '  brain --version | -V                 Show the CLI version',
      '',
      'Example:',
      '  brain "Met with Sarah today, she\'s considering consulting"',
      '',
      'Capture options:',
      '  --project <name>  Associate with a project (stored in the project column)',
      '',
      'Import options:',
      '  --source <name>    Source tag (default: "import")',
      '                     Use "import-claude" or "import-chatgpt" for provenance',
      '  --delay <ms>       Delay between API calls in ms (default: 500)',
      '  --dry-run          Parse and preview without importing',
      '  --project <name>   Associate with a project (applied to all imported thoughts)',
      '',
      'Sync-vault options:',
      '  --dry-run          Preview changes without writing files',
      '',
      'Audit options:',
      '  --since <iso>      Only consider thoughts created at or after this timestamp',
      '  --topic <slug>     (Reserved) Restrict candidates to this topic slug',
      '  --candidate-limit  Max candidate thoughts to scan (default: 50)',
      '  --resolve <id>     Resolve a contradiction by id (requires --decision)',
      '  --decision <kind>  Decision: resolved | ignored | false_positive',
      '  --note <text>      Optional explanation captured into the audit thought',
      '  --verbose          Print per-row detail in addition to the summary',
      '',
      'Wiki subcommands:',
      '  brain wiki get <slug>                Print the latest compiled page',
      '  brain wiki list [--limit N]          List compiled pages, newest first',
      '  brain wiki refresh <slug>            Recompile the page for <slug>',
      '  brain wiki refresh --all             Recompile top topics by thought count',
      '  brain wiki refresh --dry-run ...     Print what would be compiled',
      '  brain wiki reject <page_id> --reason <text>',
      '                                       Reject a page; feedback nudges next compile',
      '',
    ].join('\n'),
  );
}

function formatConfirmation(thought: ThoughtResponse['thought']): string {
  if (!thought) return '';
  const lines: string[] = [];
  if (thought.thought_type) {
    lines.push('  Type: ' + thought.thought_type);
  }
  if (thought.people.length > 0) {
    lines.push('  People: ' + thought.people.join(', '));
  }
  if (thought.topics.length > 0) {
    lines.push('  Topics: ' + thought.topics.join(', '));
  }
  for (const item of thought.action_items) {
    lines.push('  Action: ' + item);
  }
  return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function importMemories(): Promise<void> {
  const args = process.argv.slice(3);

  // Parse arguments
  let filePath: string | undefined;
  let source = 'import';
  let delay = 500;
  let dryRun = false;
  let project: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (isHelpFlag(args[i])) {
      printUsage(console.log);
      return;
    }
    if (args[i] === '--source' && i + 1 < args.length) {
      source = args[++i];
    } else if (args[i] === '--delay' && i + 1 < args.length) {
      delay = parseInt(args[++i], 10);
      if (isNaN(delay) || delay < 0) {
        console.error('Error: --delay must be a non-negative number');
        process.exit(1);
      }
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--project' && i + 1 < args.length) {
      project = args[++i];
    } else if (args[i] === '--source' || args[i] === '--delay' || args[i] === '--project') {
      // Reached only when the value is missing (the branches above need i + 1 < length).
      console.error(`Error: ${args[i]} needs a value`);
      printUsage();
      process.exit(1);
    } else if (!filePath) {
      rejectDashPath(args[i], 'import expects a file path');
      filePath = args[i];
    } else {
      console.error('Error: unexpected argument: ' + args[i]);
      printUsage();
      process.exit(1);
    }
  }

  if (!filePath) {
    console.error('Error: file path is required for import');
    printUsage();
    process.exit(1);
  }

  // A dry run sends nothing, so an invalid or refused api_url must not stop it.
  let config: Config | null = null;
  try {
    config = loadConfig();
  } catch (err) {
    if (!dryRun) throw err;
  }
  if (!config && !dryRun) {
    printSetupInstructions();
    process.exit(1);
  }
  // capture-thought only accepts the service-role key; a dry run sends nothing.
  const captureKey = dryRun ? '' : serviceKeyOrExit(config!);

  // Read and parse file
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error reading file: ' + message);
    process.exit(1);
  }

  const datePrefix = /^\[(\d{4}-\d{2}-\d{2})\]\s*-?\s*/;
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    console.error('No memories found in file.');
    process.exit(1);
  }

  console.log(`Found ${lines.length} memories in ${filePath}`);
  if (dryRun) {
    console.log('(dry run — no changes will be made)\n');
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

    const idempotency_key = createHash('sha256')
      .update(source + ':' + line.trim().toLowerCase())
      .digest('hex');

    const preview = line.length > 50 ? line.slice(0, 50) + '...' : line;

    if (dryRun) {
      const dateTag = metadata?.original_date ? ` [${metadata.original_date}]` : '';
      console.log(`${prefix} ${preview}${dateTag}`);
      captured++;
      continue;
    }

    try {
      const response = await fetch(config!.endpoints.captureUrl, {
        redirect: 'error',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + captureKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: line, source, idempotency_key, metadata, project }),
      });

      const data = (await response.json().catch(() => ({}))) as ThoughtResponse;

      if (!response.ok || !data.success) {
        console.log(`${prefix} \u2717 Failed: ${describeFailure(response.status, data)}`);
        failed++;
      } else if (data.is_duplicate) {
        console.log(`${prefix} \u223C Skipped (duplicate): "${preview}"`);
        skipped++;
      } else {
        console.log(`${prefix} \u2713 Captured: "${preview}"`);
        captured++;
      }
    } catch (err) {
      console.log(`${prefix} \u2717 Failed: ${describeError(err)}`);
      failed++;
    }

    if (delay > 0 && i < lines.length - 1) {
      await sleep(delay);
    }
  }

  console.log(`\nDone: ${captured} captured, ${skipped} skipped, ${failed} failed`);
}

export async function captureSingleThought(text: string, projectArg?: string): Promise<void> {
  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }

  const serviceKey = serviceKeyOrExit(config);
  const idempotency_key = randomUUID();

  try {
    const body: Record<string, unknown> = {
      text,
      source: 'cli',
      idempotency_key,
    };
    if (projectArg) {
      body.project = projectArg;
    }
    const response = await fetch(config.endpoints.captureUrl, {
      redirect: 'error',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json().catch(() => ({}))) as ThoughtResponse;

    if (!response.ok || !data.success) {
      console.error('\u2717 Failed to capture thought: ' + describeFailure(response.status, data));
      process.exit(1);
    }

    if (data.is_duplicate) {
      console.log('\u223C Duplicate thought (already captured)');
    } else {
      console.log('\u2713 Thought captured');
    }

    if (data.duplicate_candidate) {
      const dc = data.duplicate_candidate;
      console.log(
        `\u2139 Near-duplicate of ${dc.thought_id} (${dc.similarity.toFixed(4)}): "${dc.raw_text_preview}" \u2014 consider superseding.`,
      );
    }

    const details = formatConfirmation(data.thought);
    if (details) {
      console.log(details);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes('fetch') ||
      message.includes('ECONNREFUSED') ||
      message.includes('ENOTFOUND')
    ) {
      const cause = causeMessage(err);
      console.error(
        '\u2717 Failed to capture thought: Could not reach the API' +
          (cause ? ` (${cause})` : '') +
          '. Check your connection and BRAIN_API_URL.',
      );
    } else {
      console.error('\u2717 Failed to capture thought: ' + describeError(err));
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

export function slugify(text: string, maxLen = 50): string {
  const firstLine = text.split(/\r?\n/)[0];
  const truncated = firstLine.slice(0, maxLen);
  return truncated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function thoughtToFilename(thought: Thought, usedNames?: Set<string>): string {
  const date = thought.created_at.slice(0, 10); // YYYY-MM-DD
  const slug = slugify(thought.raw_text);
  const base = `${date}-${slug}`;
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
  // The database columns can be NULL; treat that as an empty list.
  const people = thought.people ?? [];
  const topics = thought.topics ?? [];
  const actionItems = thought.action_items ?? [];
  for (const topic of topics) {
    tags.push(topic);
  }

  const frontmatter: Record<string, unknown> = {
    id: thought.id,
    title,
    type: thought.thought_type || 'note',
    people,
    topics,
    source: thought.source,
    created: thought.created_at,
    updated: thought.updated_at,
  };
  if (actionItems.length > 0) {
    frontmatter.action_items = actionItems;
    frontmatter.action_items_resolved = thought.action_items_resolved;
  }
  frontmatter.tags = tags;

  const yamlLines: string[] = ['---'];
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
    } else if (typeof value === 'boolean') {
      yamlLines.push(`${key}: ${value}`);
    } else {
      yamlLines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }
  yamlLines.push('---');

  let body = '\n' + thought.raw_text + '\n';

  if (people.length > 0) {
    const wikilinks = people.map((p) => `[[${p.charAt(0).toUpperCase() + p.slice(1)}]]`).join(', ');
    body += `\n**People:** ${wikilinks}\n`;
  }

  return yamlLines.join('\n') + body;
}

async function fetchAllThoughts(postgrestUrl: string, apiKey: string): Promise<Thought[]> {
  const pageSize = 100;
  const allThoughts: Thought[] = [];
  let offset = 0;

  while (true) {
    const url =
      postgrestUrl +
      '?deleted_at=is.null&order=created_at.asc&select=id,raw_text,thought_type,people,topics,action_items,action_items_resolved,source,metadata,created_at,updated_at';

    const response = await fetch(url, {
      redirect: 'error',
      headers: {
        apikey: apiKey,
        Authorization: 'Bearer ' + apiKey,
        Range: `${offset}-${offset + pageSize - 1}`,
        Prefer: 'count=exact',
      },
    });

    if (response.status === 416) {
      break; // Range not satisfiable — no more rows
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(`PostgREST error: ${describeFailure(response.status, body)}`);
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

export async function syncVault(): Promise<void> {
  const args = process.argv.slice(3);

  let vaultPath: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (isHelpFlag(args[i])) {
      printUsage(console.log);
      return;
    }
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (!vaultPath) {
      rejectDashPath(args[i], 'sync-vault expects a vault path');
      vaultPath = args[i];
    } else {
      console.error('Error: unexpected argument: ' + args[i]);
      printUsage();
      process.exit(1);
    }
  }

  if (!vaultPath) {
    console.error('Error: vault path is required for sync-vault');
    printUsage();
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }

  const serviceKey = serviceKeyOrExit(config);

  const postgrestUrl = config.endpoints.restBase + '/thoughts';

  // Validate vault path
  if (existsSync(vaultPath)) {
    const stat = statSync(vaultPath);
    if (!stat.isDirectory()) {
      console.error('Error: vault path exists but is not a directory: ' + vaultPath);
      process.exit(1);
    }
  } else if (!dryRun) {
    mkdirSync(vaultPath, { recursive: true });
    console.log('Created vault directory: ' + vaultPath);
  }

  // Fetch all thoughts
  console.log('Fetching thoughts from Open Brain...');
  let thoughts: Thought[];
  try {
    thoughts = await fetchAllThoughts(postgrestUrl, serviceKey);
  } catch (err) {
    console.error('\u2717 Failed to fetch thoughts: ' + describeError(err));
    process.exit(1);
  }

  if (thoughts.length === 0) {
    console.log('No thoughts found in Open Brain.');
    return;
  }

  console.log(`Found ${thoughts.length} thoughts`);
  if (dryRun) {
    console.log('(dry run \u2014 no files will be written)\n');
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
    const newHash = createHash('sha256').update(markdown).digest('hex');
    const filePath = join(vaultPath, filename);

    // Check existing file
    let existingHash: string | null = null;
    try {
      const existing = readFileSync(filePath, 'utf-8');
      existingHash = createHash('sha256').update(existing).digest('hex');
    } catch {
      // File doesn't exist
    }

    if (existingHash === newHash) {
      unchanged++;
      continue;
    }

    const isNew = existingHash === null;
    const preview = computeTitle(thought.raw_text);
    const previewTrunc = preview.length > 50 ? preview.slice(0, 50) + '...' : preview;
    const symbol = isNew ? '\u2713' : '\u223C';
    const label = isNew ? 'new' : 'updated';

    console.log(`  ${symbol} [${label}] ${filename}: ${previewTrunc}`);

    if (!dryRun) {
      try {
        writeFileSync(filePath, markdown, 'utf-8');
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
  console.log('\nDone: ' + parts.join(', '));
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
    redirect: 'error',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

async function getFromPostgrest(
  restBase: string,
  apiKey: string,
  pathAndQuery: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = restBase + '/' + pathAndQuery;
  const response = await fetch(url, {
    redirect: 'error',
    headers: {
      apikey: apiKey,
      Authorization: 'Bearer ' + apiKey,
    },
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

export async function auditCommand(): Promise<void> {
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
    if (isHelpFlag(a)) {
      printUsage(console.log);
      return;
    }
    if (a === '--since' && i + 1 < args.length) {
      since = args[++i];
    } else if (a.startsWith('--since=')) {
      since = a.slice('--since='.length);
    } else if (a === '--topic' && i + 1 < args.length) {
      topic = args[++i];
    } else if (a.startsWith('--topic=')) {
      topic = a.slice('--topic='.length);
    } else if (a === '--candidate-limit' && i + 1 < args.length) {
      candidateLimit = parseInt(args[++i], 10);
    } else if (a.startsWith('--candidate-limit=')) {
      candidateLimit = parseInt(a.slice('--candidate-limit='.length), 10);
    } else if (a === '--resolve' && i + 1 < args.length) {
      resolveId = args[++i];
    } else if (a === '--decision' && i + 1 < args.length) {
      decision = args[++i];
    } else if (a === '--note' && i + 1 < args.length) {
      note = args[++i];
    } else if (a === '--verbose') {
      verbose = true;
    } else {
      console.error('Error: unexpected argument: ' + a);
      printUsage();
      process.exit(1);
    }
  }

  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }

  const base = config.endpoints.functionsBase;

  if (resolveId) {
    if (!decision || !['resolved', 'ignored', 'false_positive'].includes(decision)) {
      console.error('Error: --resolve requires --decision=resolved|ignored|false_positive');
      process.exit(1);
    }
    const resolveKey = serviceKeyOrExit(config);
    const patch: Record<string, unknown> = {
      status: decision,
      resolved_at: new Date().toISOString(),
    };
    const url =
      config.endpoints.restBase + '/contradictions?id=eq.' + encodeURIComponent(resolveId);
    const response = await fetch(url, {
      redirect: 'error',
      method: 'PATCH',
      headers: {
        apikey: resolveKey,
        Authorization: 'Bearer ' + resolveKey,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error(`✗ Failed to resolve contradiction: ${describeFailure(response.status, body)}`);
      process.exit(1);
    }
    // Prefer: return=representation makes PostgREST echo updated rows.
    // If RLS silently filters the UPDATE, the array comes back empty
    // even though the HTTP status is 200 — guard against that.
    const updated = (await response.json()) as Array<{ id?: string; status?: string }>;
    if (!Array.isArray(updated) || updated.length === 0) {
      console.error(
        `✗ Contradiction ${resolveId} not updated (0 rows returned). ` +
          `Check that the id exists and that BRAIN_SERVICE_KEY is the service-role key.`,
      );
      process.exit(1);
    }
    console.log(`✓ Resolved ${resolveId} as ${decision}`);
    if (note) {
      console.log(`  Note: ${note}`);
    }

    // Capture an audit thought so the resolution is itself searchable —
    // matches the behaviour of the MCP `contradictions_resolve` tool.
    const auditText = [
      `Resolved contradiction ${resolveId} as ${decision}.`,
      `Thought A: ${updated[0].id ?? '?'} (paired)`,
      note ? `Note: ${note}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const idempotency_key = createHash('sha256')
      .update(`resolve:${resolveId}:${decision}`)
      .digest('hex');
    try {
      const captureResponse = await fetch(config.endpoints.captureUrl, {
        redirect: 'error',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + resolveKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: auditText,
          source: 'cli',
          idempotency_key,
          metadata: {
            kind: 'contradiction-resolution',
            contradiction_id: resolveId,
            decision,
          },
        }),
      });
      if (!captureResponse.ok) {
        const body = await captureResponse.json().catch(() => ({}));
        console.error(
          `  (audit thought capture failed: ${describeFailure(captureResponse.status, body)})`,
        );
      }
    } catch (err) {
      console.error(`  (audit thought capture failed: ${describeError(err)})`);
    }
    return;
  }

  if (topic) {
    console.log(
      `(--topic ${topic} is currently advisory; the audit always scans by recency in v0.3.0)`,
    );
  }

  const serviceKey = serviceKeyOrExit(config);
  console.log('Running contradiction audit...');
  const { ok, status, data } = await postFunction(base, serviceKey, 'detect-contradictions', {
    since,
    candidate_limit: candidateLimit,
  });
  if (!ok) {
    console.error('✗ Audit failed: ' + describeFailure(status, data));
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
      config.endpoints.restBase,
      serviceKey,
      `contradictions?detected_at=gte.${encodeURIComponent(
        since30,
      )}&order=detected_at.desc&limit=20`,
    );
    if (result.ok) {
      const rows = result.data as ContradictionRow[];
      for (const row of rows) {
        const sevBadge = '*'.repeat(Math.min(row.severity, 5));
        console.log(`  [${row.id}] ${sevBadge} (${row.confidence.toFixed(2)})`);
        console.log(`    ${row.thought_a_id} <-> ${row.thought_b_id}`);
        console.log(`    ${row.reason}`);
      }
    } else {
      console.error(
        `  (could not list new contradictions: ${describeFailure(result.status, result.data)})`,
      );
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

export async function wikiGetCommand(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) {
    console.error('Error: brain wiki get <slug> requires a slug argument');
    process.exit(1);
  }
  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }
  const result = await getFromPostgrest(
    config.endpoints.restBase,
    serviceKeyOrExit(config),
    `current_wiki_pages?slug=eq.${encodeURIComponent(
      slug.toLowerCase(),
    )}&select=id,slug,version,content_md,partial,source_thought_count,compiled_at`,
  );
  if (!result.ok) {
    console.error(`✗ Failed: ${describeFailure(result.status, result.data)}`);
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
      page.partial ? ' (partial — some paragraphs were dropped)' : ''
    }\n`,
  );
  console.log(page.content_md);
}

export async function wikiListCommand(args: string[]): Promise<void> {
  let limit = 50;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && i + 1 < args.length) {
      limit = parseInt(args[++i], 10);
    } else if (args[i].startsWith('--limit=')) {
      limit = parseInt(args[i].slice('--limit='.length), 10);
    }
  }
  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }
  const result = await getFromPostgrest(
    config.endpoints.restBase,
    serviceKeyOrExit(config),
    `current_wiki_pages?order=compiled_at.desc&limit=${limit}&select=slug,version,source_thought_count,partial,compiled_at`,
  );
  if (!result.ok) {
    console.error(`✗ Failed: ${describeFailure(result.status, result.data)}`);
    process.exit(1);
  }
  const rows = result.data as CurrentWikiPageRow[];
  if (rows.length === 0) {
    console.log('(no wiki pages yet — run `brain wiki refresh --all`)');
    return;
  }
  for (const row of rows) {
    const partial = row.partial ? ' [partial]' : '';
    console.log(
      `  v${row.version}  ${row.slug}  (${row.source_thought_count} sources, compiled ${row.compiled_at})${partial}`,
    );
  }
}

export async function wikiRefreshCommand(args: string[]): Promise<void> {
  let slug: string | undefined;
  let all = false;
  let dryRun = false;
  let topK = 25;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--all') all = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--top' && i + 1 < args.length) topK = parseInt(args[++i], 10);
    else if (a.startsWith('--top=')) topK = parseInt(a.slice('--top='.length), 10);
    else if (!slug && !a.startsWith('--')) slug = a;
    else {
      console.error('Error: unexpected argument: ' + a);
      process.exit(1);
    }
  }

  if (!all && !slug) {
    console.error('Error: brain wiki refresh requires <slug> or --all');
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }
  const base = config.endpoints.functionsBase;
  const serviceKey = serviceKeyOrExit(config);

  let slugs: string[];
  if (all) {
    const result = await getFromPostgrest(
      config.endpoints.restBase,
      serviceKey,
      `topic_counts?order=thought_count.desc&limit=${topK}&select=slug,display_name,thought_count`,
    );
    if (!result.ok) {
      console.error(
        `✗ Failed to read topic_counts: ${describeFailure(result.status, result.data)}`,
      );
      process.exit(1);
    }
    const rows = result.data as TopicCountRow[];
    slugs = rows.filter((r) => r.thought_count >= 3).map((r) => r.slug);
    if (slugs.length === 0) {
      console.log('(no slugs with >=3 thoughts — nothing to compile)');
      return;
    }
    console.log(
      `Refreshing top ${slugs.length} slugs by thought count${dryRun ? ' (dry run)' : ''}...`,
    );
  } else {
    slugs = [slug!.toLowerCase()];
  }

  let compiled = 0;
  let refused = 0;
  let raced = 0;
  let errors = 0;

  for (const s of slugs) {
    const {
      ok,
      status: httpStatus,
      data,
    } = await postFunction(base, serviceKey, 'compile-wiki', {
      slug: s,
      dry_run: dryRun,
    });
    if (!ok) {
      console.error(`✗ ${s}: ${describeFailure(httpStatus, data)}`);
      errors += 1;
      continue;
    }
    const status = (data as { status?: string }).status;
    if (status === 'compiled' || status === 'would_compile') {
      compiled += 1;
    } else if (status === 'refused') {
      refused += 1;
    } else if (status === 'raced') {
      raced += 1;
    }
  }

  console.log(`Done: compiled ${compiled}, refused ${refused}, raced ${raced}, errors ${errors}`);
}

export async function wikiRejectCommand(args: string[]): Promise<void> {
  const pageId = args[0];
  if (!pageId) {
    console.error('Error: brain wiki reject <page_id> requires a page id');
    process.exit(1);
  }
  let reason: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--reason' && i + 1 < args.length) {
      reason = args[++i];
    } else if (args[i].startsWith('--reason=')) {
      reason = args[i].slice('--reason='.length);
    }
  }
  if (!reason) {
    console.error('Error: --reason <text> is required');
    process.exit(1);
  }

  const config = loadConfig();
  if (!config) {
    printSetupInstructions();
    process.exit(1);
  }

  const serviceKey = serviceKeyOrExit(config);
  const idempotency_key = randomUUID();
  const text = `Wiki page ${pageId} rejected: ${reason}`;
  const response = await fetch(config.endpoints.captureUrl, {
    redirect: 'error',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      source: 'cli',
      idempotency_key,
      metadata: {
        kind: 'wiki-feedback',
        page_id: pageId,
        decision: 'invalidate',
      },
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    console.error(`✗ Failed to record rejection: ${describeFailure(response.status, body)}`);
    process.exit(1);
  }
  console.log(`✓ Recorded rejection for ${pageId}`);
}

async function wikiCommand(): Promise<void> {
  const sub = process.argv[3];
  const rest = process.argv.slice(4);
  // Any position: `wiki refresh --all -h` must not run the refresh. (A reject reason of
  // exactly -h/--help therefore prints help; the wiki parsers have no `--` escape.)
  if (isHelpFlag(sub) || rest.some(isHelpFlag)) {
    printUsage(console.log);
    return;
  }
  switch (sub) {
    case 'get':
      await wikiGetCommand(rest);
      return;
    case 'list':
      await wikiListCommand(rest);
      return;
    case 'refresh':
      await wikiRefreshCommand(rest);
      return;
    case 'reject':
      await wikiRejectCommand(rest);
      return;
    default:
      console.error('Error: unknown wiki subcommand: ' + (sub ?? '(none)'));
      printUsage();
      process.exit(1);
  }
}

export async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'import') {
    await importMemories();
    return;
  }

  if (command === 'sync-vault') {
    await syncVault();
    return;
  }

  if (command === 'audit') {
    await auditCommand();
    return;
  }

  if (command === 'wiki') {
    await wikiCommand();
    return;
  }

  if (command === '--version' || command === '-V') {
    console.log(CLI_VERSION);
    return;
  }

  // The bare word `help` is reserved only when it is the sole argument;
  // `brain "help me remember X"` is one argument and is captured.
  // `brain -- help` captures the word itself.
  if (
    command === '--help' ||
    command === '-h' ||
    (command === 'help' && process.argv.length === 3)
  ) {
    printUsage(console.log);
    return;
  }

  // Single-thought capture. `--` ends flag parsing so the text may start with a dash;
  // any other leading dash is an unknown option and must never be captured as text.
  let textIndex = 2;
  if (command === '--') {
    textIndex = 3;
  } else if (command?.startsWith('-')) {
    console.error('Error: unknown option: ' + command);
    console.error(
      command === '--project'
        ? 'Hint: --project must come after the text, e.g. brain "your thought" --project <name>'
        : 'Hint: to capture text that starts with a dash, put it after --, e.g. brain -- "- buy milk"',
    );
    printUsage();
    process.exit(1);
  }

  const text = process.argv[textIndex];
  if (!text) {
    printUsage();
    process.exit(1);
  }

  // Parse options after the text (e.g. --project)
  const remaining = process.argv.slice(textIndex + 1);
  let projectArg: string | undefined;
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i] === '--project' && i + 1 < remaining.length) {
      projectArg = remaining[++i];
    } else {
      console.error('Error: unexpected argument: ' + remaining[i]);
      printUsage();
      process.exit(1);
    }
  }

  await captureSingleThought(text, projectArg);
}

/**
 * True when this file is the process entry point. Compares real paths so npm's bin
 * link (`.../bin/brain` -> `.../dist/brain.js`) counts; the Windows .cmd shim passes
 * the real path already.
 */
function isEntryPoint(): boolean {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const isMainModule = isEntryPoint();

if (isMainModule) {
  main().catch((err: unknown) => {
    console.error('Error: ' + describeError(err));
    process.exit(1);
  });
}
