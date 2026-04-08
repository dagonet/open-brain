export default function Loading() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar skeleton */}
      <div className="w-64 bg-[var(--bg-secondary)] border-r border-[var(--border)] p-6">
        <div className="h-8 w-32 rounded bg-[var(--bg-card)] animate-pulse mb-8" />
        <div className="space-y-3">
          <div className="h-6 w-full rounded bg-[var(--bg-card)] animate-pulse" />
          <div className="h-6 w-3/4 rounded bg-[var(--bg-card)] animate-pulse" />
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="flex-1 p-8">
        {/* Search bar skeleton */}
        <div className="h-12 w-full rounded-lg bg-[var(--bg-card)] animate-pulse mb-8" />

        {/* Card skeletons */}
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="h-5 w-20 rounded-full bg-[var(--bg-hover)] animate-pulse" />
                <div className="h-4 w-24 rounded bg-[var(--bg-hover)] animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-full rounded bg-[var(--bg-hover)] animate-pulse" />
                <div className="h-4 w-5/6 rounded bg-[var(--bg-hover)] animate-pulse" />
                <div className="h-4 w-2/3 rounded bg-[var(--bg-hover)] animate-pulse" />
              </div>
              <div className="flex gap-2 mt-4">
                <div className="h-5 w-16 rounded-full bg-[var(--bg-hover)] animate-pulse" />
                <div className="h-5 w-16 rounded-full bg-[var(--bg-hover)] animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
