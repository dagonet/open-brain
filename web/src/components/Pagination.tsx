import Link from "next/link";

interface PaginationProps {
  currentPage: number;
  hasMore: boolean;
  cursor?: string;
  cursorId?: string;
  searchParams: Record<string, string | undefined>;
}

function buildHref(
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>
) {
  const merged = { ...params, ...overrides };
  const qs = Object.entries(merged)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");
  return qs ? `/?${qs}` : "/";
}

export default function Pagination({
  currentPage,
  hasMore,
  cursor,
  cursorId,
  searchParams,
}: PaginationProps) {
  const prevPage = currentPage > 1 ? String(currentPage - 1) : undefined;
  const nextPage = hasMore ? String(currentPage + 1) : undefined;

  return (
    <div className="flex items-center justify-between mt-8 pt-6 border-t border-[var(--border)]">
      {prevPage ? (
        <Link
          href={buildHref(searchParams, {
            page: prevPage,
            cursor: undefined,
            cursor_id: undefined,
          })}
          className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
        >
          Previous
        </Link>
      ) : (
        <span className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] opacity-50 cursor-not-allowed">
          Previous
        </span>
      )}

      <span className="text-[var(--text-secondary)] text-sm">
        Page {currentPage}
      </span>

      {nextPage ? (
        <Link
          href={buildHref(searchParams, {
            page: nextPage,
            cursor: cursor,
            cursor_id: cursorId,
          })}
          className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
        >
          Next
        </Link>
      ) : (
        <span className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--text-muted)] opacity-50 cursor-not-allowed">
          Next
        </span>
      )}
    </div>
  );
}
