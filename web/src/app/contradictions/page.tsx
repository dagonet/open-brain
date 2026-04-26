import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import Sidebar from "@/components/Sidebar";
import { fetchDashboardCounts } from "@/lib/dashboard-counts";

interface ContradictionRow {
  id: string;
  thought_a_id: string;
  thought_b_id: string;
  reason: string;
  severity: number;
  confidence: number;
  status: string;
  detected_at: string;
}

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function ContradictionsIndexPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const status = params.status ?? "open";

  let query = supabase
    .from("contradictions")
    .select("*")
    .order("detected_at", { ascending: false })
    .limit(200);
  if (status !== "all") {
    query = query.eq("status", status);
  }
  const { data: rows } = await query;
  const contradictions = (rows as ContradictionRow[] | null) ?? [];
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
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Contradictions
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Pairs of your captured thoughts that an audit pass flagged as
            disagreeing. Run <code>brain audit</code> to scan recent thoughts.
          </p>
        </header>

        <nav className="mb-4 flex gap-2 text-xs">
          {(["open", "resolved", "ignored", "false_positive", "all"] as const).map(
            (s) => (
              <Link
                key={s}
                href={`/contradictions?status=${s}`}
                className={`rounded border px-2 py-1 ${
                  status === s
                    ? "border-[var(--text-primary)] text-[var(--text-primary)]"
                    : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {s}
              </Link>
            ),
          )}
        </nav>

        {contradictions.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--text-secondary)]">
            No contradictions in this view.
          </div>
        ) : (
          <ul className="space-y-2">
            {contradictions.map((row) => {
              const sev = "*".repeat(Math.min(row.severity, 5));
              return (
                <li
                  key={row.id}
                  className="rounded-lg border border-[var(--border)] hover:border-[var(--text-primary)] transition"
                >
                  <Link
                    href={`/contradictions/${row.id}`}
                    className="block px-4 py-3"
                  >
                    <div className="flex justify-between items-baseline gap-3">
                      <span className="font-medium text-[var(--text-primary)]">
                        {sev} ({row.confidence.toFixed(2)}) — {row.status}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)]">
                        {new Date(row.detected_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] mt-1 line-clamp-2">
                      {row.reason}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </main>
    </div>
  );
}
