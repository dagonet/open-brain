"use client";

import { useState } from "react";
import type { Thought } from "@/lib/types";

const TYPE_COLORS: Record<string, string> = {
  decision: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  insight: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  action_item: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  preference: "bg-green-500/20 text-green-300 border-green-500/30",
  bug: "bg-red-500/20 text-red-300 border-red-500/30",
  question: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
};

const DEFAULT_COLOR = "bg-gray-500/20 text-gray-300 border-gray-500/30";

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function ThoughtCard({ thought }: { thought: Thought }) {
  const [expanded, setExpanded] = useState(false);
  const truncateLen = 300;
  const needsTruncation = thought.raw_text.length > truncateLen;
  const displayText =
    expanded || !needsTruncation
      ? thought.raw_text
      : thought.raw_text.slice(0, truncateLen) + "...";

  const colorClass = TYPE_COLORS[thought.thought_type] || DEFAULT_COLOR;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 hover:border-[var(--accent)]/30 transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <span
          className={`text-xs px-2.5 py-0.5 rounded-full border ${colorClass}`}
        >
          {thought.thought_type}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {relativeTime(thought.created_at)}
        </span>
        {thought.source && (
          <span className="text-xs text-[var(--text-muted)] ml-auto">
            {thought.source}
          </span>
        )}
      </div>

      <p className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
        {displayText}
      </p>

      {needsTruncation && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] mt-2 transition-colors"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      {(thought.topics.length > 0 || thought.people.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mt-4">
          {thought.topics.map((topic) => (
            <span
              key={`t-${topic}`}
              className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
            >
              {topic}
            </span>
          ))}
          {thought.people.map((person) => (
            <span
              key={`p-${person}`}
              className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
            >
              @{person}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
