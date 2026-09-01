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
  'You MUST actively read from and write to it throughout every session.',
  '',
  'READING — Check memory early and often:',
  '- thoughts_search: At session start, search for context relevant to the current task or project.',
  '  When the user mentions a person, project, or topic, search to recall prior context.',
  '  Supports hybrid ranking (cosine similarity × recency × salience × contradiction penalty).',
  '  Optional params: project, recency_halflife_days, include_superseded, apply_contradiction_penalty.',
  '  Scopes to OPEN_BRAIN_DEFAULT_PROJECT if set and no project param provided.',
  '- thoughts_people: Check who has been mentioned before to maintain continuity across sessions.',
  '- thoughts_topics: Review known topics to connect current work to past decisions and insights.',
  '- thoughts_recent: Review recent thoughts to understand what the user has been working on.',
  '  Supports optional project filter (or OPEN_BRAIN_DEFAULT_PROJECT env var).',
  '- thoughts_review: Use at session start or when planning to get a structured overview of recent activity.',
  '- thoughts_search_expanded: Search thoughts with entity-expanded results. Prefer it to surface',
  '  connected memories a pure semantic search misses. Performs semantic search, then uses graph',
  '  traversal to find related thoughts.',
  '- system_status: Check system health if tools seem to be failing.',
  '',
  'WRITING — Capture durable knowledge:',
  '- thoughts_capture: Record decisions, insights, bug root causes, user preferences, action items,',
  '  and meeting notes. Write self-contained statements useful out of context.',
  '  Include project/feature names for searchability.',
  '  If the response includes a duplicate_candidate (near-duplicate thought), review it and use',
  '  thoughts_supersede to mark the new thought as replacing it.',
  '  Do not ask permission — capture and mention it briefly.',
  '',
  'SUPERSEEDING:',
  '- thoughts_supersede: Mark one thought as superseding another.',
  '  The superseded thought is excluded from default search results.',
  '  Use this after capture returns a duplicate_candidate to replace the old entry.',
  '',
  'DO NOT CAPTURE: routine implementation details, temporary debugging state,',
  'information already in git commits, or anything the user marks as private.',
  '',
  'DELETING:',
  '- thoughts_delete: Remove outdated or incorrect memories when noticed.',
  '',
  'LIFECYCLE (v0.6):',
  "- Every thought has a lifecycle_status: 'active' (default), 'superseded' (replaced by a newer",
  "  capture), or 'archived' (batch-archived resolved actions and cold content).",
  '- Superseded thoughts are excluded from default search results; archived thoughts are also',
  '  excluded unless include_archived is passed.',
  "- thoughts_supersede now marks the old thought as 'superseded' when replacing it.",
  '- thoughts_search accepts include_archived to include archived thoughts, and surfaces',
  '  lifecycle_status in every result row.',
];

// === wiki ===
const WIKI_INSTRUCTIONS = [
  '',
  'WIKI LAYER (v0.3.0) — pre-compiled topic pages with provenance:',
  '- For synthesis-style questions touching ≥3 thoughts on a topic, FIRST call wiki_list({limit:1})',
  '  to check if any wiki pages exist for this user. If it returns zero rows, stay in',
  '  thoughts_search mode for this repo.',
  '- Otherwise call wiki_get({slug}) for the inferred topic. If the response is marked stale',
  '  (stale_since_n_thoughts > 5 OR open_contradictions_count > 0 OR compiled_at older than 7 days),',
  '  PREFER thoughts_search over the wiki page and call wiki_refresh({slug}) afterwards.',
  '- wiki_refresh recompiles a page on demand; the user runs `brain wiki refresh --all` periodically.',
  '- The wiki page is a study guide written from your atomic thoughts; cite it but verify the',
  '  underlying thought IDs (returned in `sources`) when accuracy matters.',
  '',
  "CONTRADICTIONS — surface conflicts in the user's own notes:",
  "- contradictions_list({status:'open'}): see what disagreements the audit pass has found.",
  '- contradictions_resolve({id, decision}): mark a contradiction as resolved/ignored/false_positive',
  '  and the wiki layer will exclude the stale thought from future compilations.',
  '- contradictions_audit({since}): trigger an on-demand audit pass (also `brain audit` from the CLI).',
];

// === tasks ===
const TASKS_INSTRUCTIONS = [
  '',
  'TASKS (v0.6.0) — task-state API for tracking work items:',
  '- task_create({title, ...}): Create a new task with optional description, priority,',
  '  project, linked_thought_ids, and metadata. Title is required. Falls back to',
  '  OPEN_BRAIN_DEFAULT_PROJECT for project scope if omitted.',
  "- task_get({id}): Get a single task by UUID. Returns {error:'not found'} if",
  '  the task does not exist or has been soft-deleted.',
  '- task_list({project?, status?, priority?, limit?}): List tasks with optional',
  '  filters. Ordered by created_at descending. Default limit is 50.',
  "- task_update({id, ...}): Update a task's fields. When status changes, appends",
  "  {status, at, note} to status_history automatically. Setting status to 'cancelled'",
  '  also sets deleted_at (soft-delete). There is no separate delete tool; cancel =',
  '  soft-delete.',
  '',
  'Status lifecycle: open → in_progress → blocked | done | cancelled. Any status',
  'transition is allowed; the history is tracked transparently in status_history.',
  'Soft-deleted rows (deleted_at IS NOT NULL) are excluded from all tools.',
];

const CITATION_FOOTER = [
  '',
  "Inspired by Andrej Karpathy's LLM Wiki (https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)",
  'via Nate B Jones (https://www.youtube.com/watch?v=dxq7WtWxi44).',
];

// === entities ===
const ENTITIES_INSTRUCTIONS = [
  '',
  'ENTITIES (v0.7.0) — entity graph over the mind:',
  '- entities_search({query, entity_type?, limit?}): Search entity nodes by name/type.',
  '  Returns matching entities with mention count, thought count, and last-mentioned timestamp.',
  '- entities_graph({entity, max_nodes?}): Get the immediate neighborhood of an entity.',
  '  Returns connected entities with edge weight, display name, entity type, and shared thought count.',
];

export function buildInstructions(opts: {
  wikiEnabled: boolean;
  entitiesEnabled: boolean;
}): string {
  const lines = [...CORE_INSTRUCTIONS];
  if (opts.wikiEnabled) {
    lines.push(...WIKI_INSTRUCTIONS);
  }
  if (opts.entitiesEnabled) {
    lines.push(...ENTITIES_INSTRUCTIONS);
  }
  lines.push(...TASKS_INSTRUCTIONS);
  lines.push(...CITATION_FOOTER);
  return lines.join('\n');
}
