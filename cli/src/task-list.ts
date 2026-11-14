/**
 * Pure helpers for `brain task list`: argument parsing, the PostgREST query and output
 * formatting. No I/O here; brain.ts does the fetch. Mirrors mcp-server/src/tools/task-list.ts
 * and task-shape.ts (the CLI package cannot import from the MCP server).
 */

export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const MS_PER_DAY = 86_400_000;
const TITLE_CHARS = 100;
const DEFAULT_LIMIT = 50;
const MAX_STALE_DAYS = 36500;

/** Only these columns leave the database; `plan` is metadata->plan, not the whole metadata. */
export const TASK_LIST_SELECT =
  'id,title,status,priority,created_at,updated_at,plan:metadata->plan';

export interface TaskListOptions {
  project?: string;
  statuses?: TaskStatus[];
  staleDays?: number;
  priorityMissing: boolean;
  sort: 'created' | 'priority';
  limit: number;
  count: boolean;
  json: boolean;
}

/** Raised for bad command-line input; the message is shown to the user as is. */
export class TaskListUsageError extends Error {}

export interface TaskListRow {
  id: string;
  title: string;
  status: string;
  priority: number | null;
  created_at: string;
  updated_at: string;
  plan?: unknown;
}

export type PlanShape = 'object' | 'text' | 'none' | 'other';

export interface CompactTask {
  id: string;
  title: string;
  status: string;
  priority: number | null;
  created_at: string;
  updated_at: string;
  planned: boolean;
  plan_shape: PlanShape;
}

function parseInteger(flag: string, raw: string, min: number, max?: number): number {
  const ok = /^\d+$/.test(raw);
  const n = ok ? Number(raw) : NaN;
  if (!ok || !Number.isSafeInteger(n) || n < min || (max !== undefined && n > max)) {
    const range = max === undefined ? `an integer >= ${min}` : `an integer from ${min} to ${max}`;
    throw new TaskListUsageError(`${flag} must be ${range}`);
  }
  return n;
}

function parseStatuses(raw: string): TaskStatus[] {
  const parts = raw.split(',').map((s) => s.trim());
  const valid = new Set<string>(TASK_STATUSES);
  for (const p of parts) {
    if (!valid.has(p)) {
      throw new TaskListUsageError(
        `--status: unknown status "${p}" (use a comma list of ${TASK_STATUSES.join(', ')})`,
      );
    }
  }
  return [...new Set(parts)] as TaskStatus[];
}

/** Parse the arguments after `brain task list`. Accepts `--flag value` and `--flag=value`. */
export function parseTaskListArgs(args: string[]): TaskListOptions {
  const opts: TaskListOptions = {
    priorityMissing: false,
    sort: 'created',
    limit: DEFAULT_LIMIT,
    count: false,
    json: false,
  };
  const valueFlags = new Set(['--project', '--status', '--stale-days', '--sort', '--limit']);

  for (let i = 0; i < args.length; i++) {
    let flag = args[i];
    let value: string | undefined;
    const eq = flag.startsWith('--') ? flag.indexOf('=') : -1;
    if (eq > 0) {
      value = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }

    if (flag === '--priority-missing' || flag === '--count' || flag === '--json') {
      if (value !== undefined) throw new TaskListUsageError(`${flag} does not take a value`);
      if (flag === '--priority-missing') opts.priorityMissing = true;
      else if (flag === '--count') opts.count = true;
      else opts.json = true;
      continue;
    }
    if (!valueFlags.has(flag)) {
      throw new TaskListUsageError(`unexpected argument: ${args[i]}`);
    }
    if (value === undefined) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new TaskListUsageError(`${flag} requires a value`);
      }
      value = next;
      i++;
    }
    if (value === '') throw new TaskListUsageError(`${flag} requires a value`);

    switch (flag) {
      case '--project':
        opts.project = value;
        break;
      case '--status':
        opts.statuses = parseStatuses(value);
        break;
      case '--stale-days':
        opts.staleDays = parseInteger(flag, value, 1, MAX_STALE_DAYS);
        break;
      case '--limit':
        opts.limit = parseInteger(flag, value, 1);
        break;
      case '--sort':
        if (value !== 'created' && value !== 'priority') {
          throw new TaskListUsageError('--sort must be "created" or "priority"');
        }
        opts.sort = value;
        break;
    }
  }
  return opts;
}

/**
 * Path and query (relative to the REST base) for the tasks table. Read-only: filters,
 * ordering and a limit only. `--count` selects just `id` and `limit=1`; the total comes
 * from the `Content-Range` header of a `Prefer: count=exact` request, so the default
 * limit never caps it.
 */
export function buildTaskListPath(
  opts: TaskListOptions,
  project?: string,
  now = Date.now(),
): string {
  const q: string[] = [];
  q.push('select=' + (opts.count ? 'id' : TASK_LIST_SELECT));
  q.push('deleted_at=is.null');
  if (project) q.push('project=eq.' + encodeURIComponent(project));
  if (opts.statuses) q.push(`status=in.(${opts.statuses.join(',')})`);
  if (opts.priorityMissing) q.push('priority=is.null');
  if (opts.staleDays !== undefined) {
    const cutoff = new Date(now - opts.staleDays * MS_PER_DAY).toISOString();
    q.push('updated_at=lt.' + encodeURIComponent(cutoff));
  }
  if (opts.count) {
    q.push('limit=1');
  } else {
    q.push(
      opts.sort === 'priority'
        ? 'order=priority.asc.nullslast,updated_at.asc'
        : 'order=created_at.desc',
    );
    q.push('limit=' + opts.limit);
  }
  return 'tasks?' + q.join('&');
}

/** Total row count from a PostgREST `Content-Range` header such as `0-0/17` (or a star before the slash for an empty result). */
export function parseContentRangeTotal(header: string | null): number | null {
  const m = header === null ? null : /\/(\d+)$/.exec(header);
  return m ? Number(m[1]) : null;
}

/** Cut to `max` code points (not UTF-16 units); append "…" only when cut. */
export function truncateCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join('') + '…';
}

/** True when plan is an object with non-empty owner, goal, next_step and done_check strings. */
export function isPlanned(plan: unknown): boolean {
  if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) return false;
  const p = plan as Record<string, unknown>;
  return ['owner', 'goal', 'next_step', 'done_check'].every((k) => {
    const v = p[k];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

/** Shape of metadata.plan: "object", "text" (a plain string), "none" (absent or null) or "other". */
export function planShape(plan: unknown): PlanShape {
  if (plan === undefined || plan === null) return 'none';
  if (typeof plan === 'string') return 'text';
  return typeof plan === 'object' && !Array.isArray(plan) ? 'object' : 'other';
}

export function compactTask(row: TaskListRow): CompactTask {
  return {
    id: row.id,
    title: truncateCodePoints(row.title, TITLE_CHARS),
    status: row.status,
    priority: row.priority,
    created_at: row.created_at,
    updated_at: row.updated_at,
    planned: isPlanned(row.plan),
    plan_shape: planShape(row.plan),
  };
}

/** One tab-separated line: id, status, priority, updated date, planned, title. */
export function formatTaskLine(row: TaskListRow): string {
  const t = compactTask(row);
  // A tab or newline inside a title would break one-line-per-task parsing.
  const title = t.title.replace(/[\t\r\n]+/g, ' ');
  return [
    t.id,
    t.status,
    t.priority === null || t.priority === undefined ? '' : String(t.priority),
    t.updated_at.slice(0, 10),
    t.planned ? 'yes' : 'no',
    title,
  ].join('\t');
}
