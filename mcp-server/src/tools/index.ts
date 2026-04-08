import type { ToolDefinition } from "./registry.js";
import { definition as thoughtsSearch } from "./semantic-search.js";
import { definition as thoughtsRecent } from "./list-recent.js";
import { definition as thoughtsDelete } from "./delete-thought.js";
import { definition as systemStatus } from "./system-status.js";
import { definition as thoughtsPeople } from "./list-people.js";
import { definition as thoughtsTopics } from "./list-topics.js";
import { definition as thoughtsReview } from "./weekly-review.js";
import { definition as thoughtsCapture } from "./capture-thought.js";

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
];
