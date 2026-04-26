// MCP server `instructions` string — guides how Claude Code uses Open Brain.
//
// Inspired by Andrej Karpathy's LLM Wiki gist
//   https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
// via Nate B Jones
//   https://www.youtube.com/watch?v=dxq7WtWxi44
//
// Sections are delimited so future additions can append cleanly.

const CORE_INSTRUCTIONS = [
  "Open Brain is the user's personal memory system — a second brain that persists across sessions.",
  "You MUST actively read from and write to it throughout every session.",
  "",
  "READING — Check memory early and often:",
  "- thoughts_search: At session start, search for context relevant to the current task or project.",
  "  When the user mentions a person, project, or topic, search to recall prior context.",
  "- thoughts_people: Check who has been mentioned before to maintain continuity across sessions.",
  "- thoughts_topics: Review known topics to connect current work to past decisions and insights.",
  "- thoughts_recent: Review recent thoughts to understand what the user has been working on.",
  "- thoughts_review: Use at session start or when planning to get a structured overview of recent activity.",
  "- system_status: Check system health if tools seem to be failing.",
  "",
  "WRITING — Capture durable knowledge:",
  "- thoughts_capture: Record decisions, insights, bug root causes, user preferences, action items,",
  "  and meeting notes. Write self-contained statements useful out of context.",
  "  Include project/feature names for searchability.",
  "  Do not ask permission — capture and mention it briefly.",
  "",
  "DO NOT CAPTURE: routine implementation details, temporary debugging state,",
  "information already in git commits, or anything the user marks as private.",
  "",
  "DELETING:",
  "- thoughts_delete: Remove outdated or incorrect memories when noticed.",
];

// === wiki ===
const WIKI_INSTRUCTIONS = [
  "",
  "WIKI LAYER (v0.3.0) — pre-compiled topic pages with provenance:",
  "- For synthesis-style questions touching ≥3 thoughts on a topic, FIRST call wiki_list({limit:1})",
  "  to check if any wiki pages exist for this user. If it returns zero rows, stay in",
  "  thoughts_search mode for this repo.",
  "- Otherwise call wiki_get({slug}) for the inferred topic. If the response is marked stale",
  "  (stale_since_n_thoughts > 5 OR open_contradictions_count > 0 OR compiled_at older than 7 days),",
  "  PREFER thoughts_search over the wiki page and call wiki_refresh({slug}) afterwards.",
  "- wiki_refresh recompiles a page on demand; the user runs `brain wiki refresh --all` periodically.",
  "- The wiki page is a study guide written from your atomic thoughts; cite it but verify the",
  "  underlying thought IDs (returned in `sources`) when accuracy matters.",
  "",
  "CONTRADICTIONS — surface conflicts in the user's own notes:",
  "- contradictions_list({status:'open'}): see what disagreements the audit pass has found.",
  "- contradictions_resolve({id, decision}): mark a contradiction as resolved/ignored/false_positive",
  "  and the wiki layer will exclude the stale thought from future compilations.",
  "- contradictions_audit({since}): trigger an on-demand audit pass (also `brain audit` from the CLI).",
];

const CITATION_FOOTER = [
  "",
  "Inspired by Andrej Karpathy's LLM Wiki (https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)",
  "via Nate B Jones (https://www.youtube.com/watch?v=dxq7WtWxi44).",
];

export function buildInstructions(opts: { wikiEnabled: boolean }): string {
  const lines = [...CORE_INSTRUCTIONS];
  if (opts.wikiEnabled) {
    lines.push(...WIKI_INSTRUCTIONS);
  }
  lines.push(...CITATION_FOOTER);
  return lines.join("\n");
}
