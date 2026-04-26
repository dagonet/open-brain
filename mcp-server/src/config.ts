// Per-repo opt-out for the wiki and contradictions tool families.
//
// Set `OPEN_BRAIN_TOOLS_DISABLED=wiki,contradictions` in a project's
// `.mcp.json` env block to silence those tool families in that workspace.
// Useful for sensitive client repos where wiki/audit overhead is unwanted.

export type ToolFamily = "wiki" | "contradictions";

const KNOWN_FAMILIES: ToolFamily[] = ["wiki", "contradictions"];

export function disabledFamilies(envValue: string | undefined): Set<ToolFamily> {
  const result = new Set<ToolFamily>();
  if (!envValue) return result;
  for (const raw of envValue.split(",")) {
    const trimmed = raw.trim().toLowerCase();
    if ((KNOWN_FAMILIES as string[]).includes(trimmed)) {
      result.add(trimmed as ToolFamily);
    }
  }
  return result;
}

export function familyForToolName(name: string): ToolFamily | null {
  if (name.startsWith("wiki_")) return "wiki";
  if (name.startsWith("contradictions_")) return "contradictions";
  return null;
}
