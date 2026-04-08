"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface SearchBarProps {
  topics: string[];
  people: string[];
  thoughtTypes: string[];
}

export default function SearchBar({
  topics,
  people,
  thoughtTypes,
}: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Reset pagination when filters change
      params.delete("page");
      params.delete("cursor");
      params.delete("cursor_id");
      router.push(`/?${params.toString()}`);
    },
    [router, searchParams]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams("q", query);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, updateParams]);

  return (
    <div className="flex flex-col sm:flex-row gap-3 mb-6">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search thoughts..."
        className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
      />

      <select
        value={searchParams.get("type") ?? ""}
        onChange={(e) => updateParams("type", e.target.value)}
        className="px-3 py-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
      >
        <option value="">All types</option>
        {thoughtTypes.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get("topic") ?? ""}
        onChange={(e) => updateParams("topic", e.target.value)}
        className="px-3 py-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
      >
        <option value="">All topics</option>
        {topics.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get("person") ?? ""}
        onChange={(e) => updateParams("person", e.target.value)}
        className="px-3 py-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
      >
        <option value="">All people</option>
        {people.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </div>
  );
}
