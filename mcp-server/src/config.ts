// Per-repo opt-out for ui, contradictions, and tasks tool families.
//
// Set `OPEN_BRAIN_TOOLS_DISABLED=wiki,contradictions,tasks` in a project's
// `.mcp.json` env block to silence those tool families in that workspace.
// Useful for sensitive client repos where wiki/audit/task overhead is unwanted.

export type ToolFamily = 'wiki' | 'contradictions' | 'tasks' | 'entities';

const KNOWN_FAMILIES: ToolFamily[] = ['wiki', 'contradictions', 'tasks', 'entities'];

export function disabledFamilies(envValue: string | undefined): Set<ToolFamily> {
  const result = new Set<ToolFamily>();
  if (!envValue) return result;
  for (const raw of envValue.split(',')) {
    const trimmed = raw.trim().toLowerCase();
    if ((KNOWN_FAMILIES as string[]).includes(trimmed)) {
      result.add(trimmed as ToolFamily);
    }
  }
  return result;
}

export function familyForToolName(name: string): ToolFamily | null {
  if (name.startsWith('wiki_')) return 'wiki';
  if (name.startsWith('contradictions_')) return 'contradictions';
  if (name.startsWith('task_')) return 'tasks';
  if (name.startsWith('entities_')) return 'entities';
  return null;
}

/**
 * Resolves the effective project scope for a tool call.
 *
 * Priority: explicit param > OPEN_BRAIN_DEFAULT_PROJECT env var > null (no filter).
 * The env var allows per-workspace `.mcp.json` configuration so each project
 * workspace automatically scopes memory operations to its own project without
 * callers needing to pass the param explicitly.
 */
export function resolveProject(explicitParam: string | null | undefined): string | null {
  if (explicitParam) return explicitParam;
  const fromEnv = process.env.OPEN_BRAIN_DEFAULT_PROJECT;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return null;
}
