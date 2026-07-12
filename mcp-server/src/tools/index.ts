import type { ToolDefinition } from "./registry.js";
import { definition as thoughtsSearch } from "./semantic-search.js";
import { definition as thoughtsRecent } from "./list-recent.js";
import { definition as thoughtsDelete } from "./delete-thought.js";
import { definition as systemStatus } from "./system-status.js";
import { definition as thoughtsPeople } from "./list-people.js";
import { definition as thoughtsTopics } from "./list-topics.js";
import { definition as thoughtsReview } from "./weekly-review.js";
import { definition as thoughtsCapture } from "./capture-thought.js";
import { definition as thoughtsSupersede } from "./supersede-thought.js";
import { definition as wikiGet } from "./wiki-get.js";
import { definition as wikiList } from "./wiki-list.js";
import { definition as wikiRefresh } from "./wiki-refresh.js";
import { definition as contradictionsList } from "./contradictions-list.js";
import { definition as contradictionsResolve } from "./contradictions-resolve.js";
import { definition as contradictionsAudit } from "./contradictions-audit.js";
import { definition as taskCreate } from "./task-create.js";
import { definition as taskGet } from "./task-get.js";
import { definition as taskList } from "./task-list.js";
import { definition as taskUpdate } from "./task-update.js";
import { definition as entitiesSearch } from "./entities-search.js";
import { definition as entitiesGraph } from "./entities-graph.js";
import { definition as thoughtsSearchExpanded } from "./thoughts-search-expanded.js";

export type { ToolDefinition } from "./registry.js";
export type { Deps } from "./registry.js";

export const allTools: ToolDefinition[] = [
  thoughtsSearch,
  thoughtsRecent,
  thoughtsDelete,
  systemStatus,
  thoughtsPeople,
  thoughtsTopics,
  thoughtsReview,
  thoughtsCapture,
  thoughtsSupersede,
  wikiGet,
  wikiList,
  wikiRefresh,
  contradictionsList,
  contradictionsResolve,
  contradictionsAudit,
  taskCreate,
  taskGet,
  taskList,
  taskUpdate,
  entitiesSearch,
  entitiesGraph,
  thoughtsSearchExpanded,
];
