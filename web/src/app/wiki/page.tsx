import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import Sidebar from "@/components/Sidebar";
import { fetchDashboardCounts } from "@/lib/dashboard-counts";

interface CurrentWikiPageRow {
  id: string;
  slug: string;
  version: number;
  source_thought_count: number;
  partial: boolean;
  compiled_at: string;
}

export default async function WikiIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: pages } = await supabase
    .from("current_wiki_pages")
    .select("id, slug, version, source_thought_count, partial, compiled_at")
    .order("compiled_at", { ascending: false })
    .limit(200);

  const rows = (pages as CurrentWikiPageRow[] | null) ?? [];
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
            Wiki pages
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Compiled topic pages with provenance back to your source thoughts.
            Run <code>brain wiki refresh --all</code> to generate or update.
          </p>
        </header>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--text-secondary)]">
            <p className="mb-2">No wiki pages yet.</p>
            <p className="text-sm">
              Run <code>brain wiki refresh --all</code> to compile your first
              pages.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-lg border border-[var(--border)] hover:border-[var(--text-primary)] transition"
              >
                <Link
                  href={`/wiki/${encodeURIComponent(row.slug)}`}
                  className="block px-4 py-3"
                >
                  <div className="flex justify-between items-baseline gap-3">
                    <span className="font-medium text-[var(--text-primary)]">
                      {row.slug}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)]">
                      v{row.version} · {row.source_thought_count} sources
                      {row.partial ? " · partial" : ""}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] mt-1">
                    Compiled {new Date(row.compiled_at).toLocaleString()}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        </div>
      </main>
    </div>
  );
}
