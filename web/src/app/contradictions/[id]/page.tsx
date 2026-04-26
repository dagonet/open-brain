import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import Sidebar from "@/components/Sidebar";
import { fetchDashboardCounts } from "@/lib/dashboard-counts";
import { resolveContradiction } from "../../wiki/actions";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface ContradictionRow {
  id: string;
  thought_a_id: string;
  thought_b_id: string;
  reason: string;
  severity: number;
  confidence: number;
  status: string;
  detected_at: string;
  resolved_at: string | null;
}

interface ThoughtRow {
  id: string;
  raw_text: string;
  topics: string[] | null;
  created_at: string;
  deleted_at: string | null;
}

export default async function ContradictionDetailPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: row } = await supabase
    .from("contradictions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!row) {
    notFound();
  }
  const contra = row as ContradictionRow;

  const { data: pair } = await supabase
    .from("thoughts")
    .select("id, raw_text, topics, created_at, deleted_at")
    .in("id", [contra.thought_a_id, contra.thought_b_id]);
  const thoughts = (pair as ThoughtRow[] | null) ?? [];
  const thoughtA = thoughts.find((t) => t.id === contra.thought_a_id);
  const thoughtB = thoughts.find((t) => t.id === contra.thought_b_id);
  const navCounts = await fetchDashboardCounts();

  return (
    <div className="flex min-h-screen">
      <Sidebar
        totalThoughts={navCounts.totalThoughts}
        wikiPages={navCounts.wikiPages}
        openContradictions={navCounts.openContradictions}
      />
      <main className="flex-1 p-6 md:p-8">
        <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <p className="text-sm text-[var(--text-secondary)] mb-1">
            <Link
              href="/contradictions"
              className="underline hover:text-[var(--text-primary)]"
            >
              ← All contradictions
            </Link>
          </p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Contradiction
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Severity {contra.severity}/5 · confidence{" "}
            {contra.confidence.toFixed(2)} · {contra.status}
          </p>
        </header>

        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-soft)] p-3 mb-6 text-sm">
          <strong>Reason:</strong> {contra.reason}
        </div>

        <div className="grid md:grid-cols-2 gap-3 mb-6">
          {[thoughtA, thoughtB].map((t, idx) =>
            t ? (
              <div
                key={t.id}
                className={`rounded border p-3 text-sm ${
                  t.deleted_at
                    ? "border-red-500/40 bg-red-500/5"
                    : "border-[var(--border)]"
                }`}
              >
                <div className="text-xs text-[var(--text-secondary)] mb-2 flex justify-between">
                  <span>
                    Note {idx === 0 ? "A" : "B"}
                    {t.deleted_at ? " · deleted" : ""}
                  </span>
                  <span>{new Date(t.created_at).toLocaleString()}</span>
                </div>
                <p className="text-[var(--text-primary)] whitespace-pre-wrap">
                  {t.raw_text}
                </p>
                {t.topics && t.topics.length > 0 ? (
                  <div className="text-xs text-[var(--text-secondary)] mt-2">
                    Topics: {t.topics.join(", ")}
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                key={idx}
                className="rounded border border-red-500/40 bg-red-500/5 p-3 text-sm text-[var(--text-secondary)]"
              >
                Note {idx === 0 ? "A" : "B"} could not be loaded (hard-deleted?)
              </div>
            ),
          )}
        </div>

        {contra.status === "open" ? (
          <section className="border-t border-[var(--border)] pt-4">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              Resolve
            </h2>
            <form action={resolveContradiction} className="space-y-2">
              <input type="hidden" name="id" value={contra.id} />
              <label className="block text-sm">
                <span className="text-[var(--text-secondary)]">Decision</span>
                <select
                  name="decision"
                  className="block mt-1 rounded border border-[var(--border)] bg-transparent p-2 text-sm text-[var(--text-primary)]"
                  defaultValue="resolved"
                >
                  <option value="resolved">resolved</option>
                  <option value="ignored">ignored</option>
                  <option value="false_positive">false_positive</option>
                </select>
              </label>
              <textarea
                name="note"
                rows={3}
                maxLength={500}
                placeholder="Optional explanation captured into an audit thought"
                className="w-full rounded border border-[var(--border)] bg-transparent p-2 text-sm text-[var(--text-primary)]"
              />
              <button
                type="submit"
                className="rounded border border-emerald-500/60 px-3 py-1 text-sm text-emerald-400 hover:bg-emerald-500/10"
              >
                Submit
              </button>
            </form>
          </section>
        ) : (
          <p className="text-sm text-[var(--text-secondary)]">
            This contradiction is already {contra.status}
            {contra.resolved_at
              ? ` (at ${new Date(contra.resolved_at).toLocaleString()})`
              : ""}
            .
          </p>
        )}
        </div>
      </main>
    </div>
  );
}
