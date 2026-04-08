export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-6xl mb-4 opacity-30">&#x1F9E0;</div>
      <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
        No thoughts found
      </h3>
      <p className="text-[var(--text-secondary)] max-w-sm">
        Try adjusting your search query or filters to find what you are looking
        for.
      </p>
    </div>
  );
}
