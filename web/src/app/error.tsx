"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="text-5xl mb-4">!</div>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
          Something went wrong
        </h2>
        <p className="text-[var(--text-secondary)] mb-6">
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
