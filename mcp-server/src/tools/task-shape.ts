/** Shared row-shaping helpers for the task tools (not a tool itself). */

const TITLE_CHARS = 100;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Cut to `max` code points (not UTF-16 units); append "…" only when cut. */
export function truncateCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  if (points.length <= max) return text;
  return points.slice(0, max).join('') + '…';
}

/** True when plan is an object with non-empty owner, goal, next_step and done_check strings. */
export function isPlanned(plan: unknown): boolean {
  if (!isPlainObject(plan)) return false;
  return ['owner', 'goal', 'next_step', 'done_check'].every((k) => {
    const v = plan[k];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

/** Length of status_history, 0 when it is not an array. */
export function historyLen(row: Record<string, unknown>): number {
  return Array.isArray(row.status_history) ? row.status_history.length : 0;
}

/** metadata.plan of a full row, or null. */
export function planOf(row: Record<string, unknown>): unknown {
  return isPlainObject(row.metadata) ? (row.metadata.plan ?? null) : null;
}

/** Compact row from a row that carries a `plan` key (selected alias or taken from metadata). */
export function compactRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    title: typeof row.title === 'string' ? truncateCodePoints(row.title, TITLE_CHARS) : row.title,
    status: row.status,
    priority: row.priority,
    created_at: row.created_at,
    updated_at: row.updated_at,
    planned: isPlanned(row.plan),
  };
}
