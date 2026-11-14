/**
 * Pure helpers for `brain task set`: argument parsing, the RPC body and output shaping.
 * No I/O here; brain.ts does the fetch. The write itself is the database function
 * `task_apply_update` (migration 019), the same one the MCP `task_update` tool calls, so
 * status history, note-only entries, cancel and "nothing changed" all come from there.
 */
import { formatTaskLine, type TaskListRow } from './task-list.js';

/** Unlike `task list`, `cancelled` is allowed here: it soft-deletes the task. */
export const TASK_SET_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type TaskSetStatus = (typeof TASK_SET_STATUSES)[number];

/** Raised for bad command-line input; the message is shown to the user as is. */
export class TaskSetUsageError extends Error {}

export interface TaskSetOptions {
  id: string;
  status?: TaskSetStatus;
  priority?: number;
  note?: string;
  json: boolean;
}

/** The columns of the returned `tasks` row that this command reads. */
export interface TaskSetRow {
  id: string;
  title: string;
  status: string;
  priority: number | null;
  created_at: string;
  updated_at: string;
  metadata?: unknown;
  status_history?: unknown;
}

export interface TaskSetEcho {
  id: string;
  status: string;
  priority: number | null;
  updated_at: string;
  history_len: number;
}

export const MIGRATION_019_MISSING =
  'task set needs database migration 019 (task_apply_update): run `supabase db push --remote` (link the checkout first), see docs/upgrading.md';

// Any 8-4-4-4-12 hex, like zod's z.guid() in the MCP server: no RFC version or variant bits.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALUE_FLAGS = new Set(['--status', '--priority', '--note']);

function parsePriority(raw: string): number {
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > 5) {
    throw new TaskSetUsageError('--priority must be an integer from 1 to 5');
  }
  return n;
}

function parseStatus(raw: string): TaskSetStatus {
  if (!(TASK_SET_STATUSES as readonly string[]).includes(raw)) {
    throw new TaskSetUsageError(`--status must be one of ${TASK_SET_STATUSES.join(', ')}`);
  }
  return raw as TaskSetStatus;
}

/**
 * Parse the arguments after `brain task set`: one `<id>` plus `--status`, `--priority`,
 * `--note` (each at most once, `--flag value` or `--flag=value`) and `--json`.
 *
 * A note that starts with `--` is only accepted as `--note=--text`: in the space form the
 * next word is taken for a flag and the call fails, as in `task list`. A repeated flag is
 * an error, not last-wins. A blank note is an error, because the database ignores it.
 */
export function parseTaskSetArgs(args: string[]): TaskSetOptions {
  let id: string | undefined;
  let json = false;
  const seen = new Map<string, string>();

  for (let i = 0; i < args.length; i++) {
    let flag = args[i];
    if (!flag.startsWith('-')) {
      if (id !== undefined) throw new TaskSetUsageError(`unexpected argument: ${flag}`);
      id = flag;
      continue;
    }
    let value: string | undefined;
    const eq = flag.startsWith('--') ? flag.indexOf('=') : -1;
    if (eq > 0) {
      value = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }

    if (flag === '--json') {
      if (value !== undefined) throw new TaskSetUsageError('--json does not take a value');
      json = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new TaskSetUsageError(`unexpected argument: ${args[i]}`);
    if (seen.has(flag)) throw new TaskSetUsageError(`${flag} given more than once`);

    if (value === undefined) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new TaskSetUsageError(
          `${flag} requires a value` +
            (flag === '--note' ? ' (write --note=<text> for text that starts with --)' : ''),
        );
      }
      value = next;
      i++;
    }
    if (value === '') throw new TaskSetUsageError(`${flag} requires a value`);
    seen.set(flag, value);
  }

  if (id === undefined) throw new TaskSetUsageError('<id> is required');
  if (!GUID.test(id)) throw new TaskSetUsageError('<id> must be a UUID (8-4-4-4-12 hex digits)');

  const opts: TaskSetOptions = { id, json };
  const status = seen.get('--status');
  const priority = seen.get('--priority');
  const note = seen.get('--note');
  if (status !== undefined) opts.status = parseStatus(status);
  if (priority !== undefined) opts.priority = parsePriority(priority);
  if (note !== undefined) {
    // JavaScript trim() strips the same characters as the function's btrim.
    if (note.trim() === '') throw new TaskSetUsageError('--note must not be blank');
    opts.note = note;
  }
  if (opts.status === undefined && opts.priority === undefined && opts.note === undefined) {
    throw new TaskSetUsageError('give at least one of --status, --priority or --note');
  }
  return opts;
}

/** Body for POST /rpc/task_apply_update. Keys that were not given are left out. */
export function buildTaskSetBody(opts: TaskSetOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    p_id: opts.id,
    p_patch: opts.priority !== undefined ? { priority: opts.priority } : {},
  };
  if (opts.status !== undefined) body.p_status = opts.status;
  if (opts.note !== undefined) body.p_note = opts.note;
  return body;
}

/** True when PostgREST or Postgres says task_apply_update is missing (migration 019 not applied). Same test as the MCP server. */
export function isMissingTaskFunction(data: unknown): boolean {
  if (data === null || typeof data !== 'object') return false;
  const { code, message } = data as { code?: unknown; message?: unknown };
  const text = typeof message === 'string' ? message : '';
  const names = /task_apply_update/.test(text);
  return (
    code === 'PGRST202' ||
    (code === '42883' && names) ||
    (names && /function .* does not exist/i.test(text))
  );
}

/** The `--json` answer: the same compact echo as MCP `task_update` with `echo: "compact"`. */
export function taskSetEcho(row: TaskSetRow): TaskSetEcho {
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    updated_at: row.updated_at,
    history_len: Array.isArray(row.status_history) ? row.status_history.length : 0,
  };
}

/** One `task list` style line for the returned row (plan is read from metadata.plan). */
export function formatTaskSetLine(row: TaskSetRow): string {
  const meta = row.metadata;
  const plan =
    meta !== null && typeof meta === 'object' && !Array.isArray(meta)
      ? (meta as Record<string, unknown>).plan
      : undefined;
  const listRow: TaskListRow = { ...row, plan };
  return formatTaskLine(listRow);
}
