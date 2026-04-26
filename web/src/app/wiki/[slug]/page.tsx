import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { rejectWikiPage, refreshWikiPage } from "../actions";

interface PageProps {
  params: Promise<{ slug: string }>;
}

interface WikiPageRow {
  id: string;
  slug: string;
  version: number;
  content_md: string;
  partial: boolean;
  source_thought_count: number;
  oldest_source_at: string | null;
  newest_source_at: string | null;
  compiled_at: string;
}

interface StalenessRow {
  page_id: string;
  stale_since_n_thoughts: number;
  open_contradictions_count: number;
}

interface ThoughtRow {
  id: string;
  raw_text: string;
  created_at: string;
  deleted_at: string | null;
}

interface SourceJoin {
  thought_id: string;
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export default async function WikiSlugPage({ params }: PageProps) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug).toLowerCase();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: page } = await supabase
    .from("current_wiki_pages")
    .select(
      "id, slug, version, content_md, partial, source_thought_count, oldest_source_at, newest_source_at, compiled_at",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!page) {
    notFound();
  }
  const wikiPage = page as WikiPageRow;

  const { data: staleness } = await supabase
    .from("wiki_page_staleness")
    .select("page_id, stale_since_n_thoughts, open_contradictions_count")
    .eq("page_id", wikiPage.id)
    .maybeSingle();
  const stale = (staleness as StalenessRow | null) ?? {
    page_id: wikiPage.id,
    stale_since_n_thoughts: 0,
    open_contradictions_count: 0,
  };

  const { data: joins } = await supabase
    .from("wiki_sources")
    .select("thought_id")
    .eq("page_id", wikiPage.id);
  const thoughtIds = ((joins as SourceJoin[] | null) ?? []).map(
    (j) => j.thought_id,
  );
  let thoughts: ThoughtRow[] = [];
  if (thoughtIds.length > 0) {
    const { data } = await supabase
      .from("thoughts")
      .select("id, raw_text, created_at, deleted_at")
      .in("id", thoughtIds);
    thoughts = (data as ThoughtRow[] | null) ?? [];
  }
  const sourcesById = new Map(thoughts.map((t) => [t.id, t]));

  const compiledDays = daysSince(wikiPage.compiled_at);

  return (
    <div className="min-h-screen p-6 md:p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-4">
          <p className="text-sm text-[var(--text-secondary)] mb-1">
            <Link href="/wiki" className="underline hover:text-[var(--text-primary)]">
              ← All wiki pages
            </Link>
          </p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            {wikiPage.slug}
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            v{wikiPage.version} · {wikiPage.source_thought_count} sources
            {wikiPage.partial ? " · partial" : ""}
          </p>
        </header>

        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-soft)] p-3 mb-4 text-sm text-[var(--text-secondary)]">
          Compiled {compiledDays} day{compiledDays === 1 ? "" : "s"} ago.
          {stale.stale_since_n_thoughts > 0
            ? ` ${stale.stale_since_n_thoughts} new thoughts on this topic since.`
            : ""}
          {stale.open_contradictions_count > 0 ? (
            <>
              {" "}
              <Link
                href="/contradictions?status=open"
                className="underline text-amber-400"
              >
                {stale.open_contradictions_count} open contradictions.
              </Link>
            </>
          ) : null}
          <form action={refreshWikiPage} className="inline">
            <input type="hidden" name="slug" value={wikiPage.slug} />
            <button
              type="submit"
              className="ml-2 underline hover:text-[var(--text-primary)]"
            >
              Refresh now
            </button>
          </form>
        </div>

        <article className="prose prose-invert max-w-none whitespace-pre-wrap text-[var(--text-primary)] mb-6">
          {wikiPage.content_md}
        </article>

        <section className="mt-6">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            Source thoughts
          </h2>
          <ul className="space-y-2">
            {thoughts.map((t) => (
              <li
                key={t.id}
                className={`rounded border ${
                  t.deleted_at
                    ? "border-red-500/40 bg-red-500/5"
                    : "border-[var(--border)]"
                } p-3 text-sm`}
              >
                <div className="text-xs text-[var(--text-secondary)] mb-1 flex justify-between">
                  <span>
                    {t.id}
                    {t.deleted_at ? " · deleted" : ""}
                  </span>
                  <span>{new Date(t.created_at).toLocaleString()}</span>
                </div>
                <p className="text-[var(--text-primary)] whitespace-pre-wrap">
                  {t.raw_text}
                </p>
              </li>
            ))}
            {thoughts.length === 0 ? (
              <li className="text-sm text-[var(--text-secondary)]">
                (No source rows recorded — page may pre-date wiki_sources.)
              </li>
            ) : null}
          </ul>
          {thoughtIds.some((id) => !sourcesById.has(id)) ? (
            <p className="text-xs text-amber-400 mt-2">
              Some cited thoughts could not be loaded — they may have been
              hard-deleted from the database.
            </p>
          ) : null}
        </section>

        <section className="mt-8 border-t border-[var(--border)] pt-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            Reject this page
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mb-2">
            Tell the wiki why this compilation is wrong; the next refresh will
            see your feedback.
          </p>
          <form action={rejectWikiPage} className="space-y-2">
            <input type="hidden" name="page_id" value={wikiPage.id} />
            <input type="hidden" name="slug" value={wikiPage.slug} />
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={500}
              rows={3}
              placeholder="Reason (minimum 5 characters)"
              className="w-full rounded border border-[var(--border)] bg-transparent p-2 text-sm text-[var(--text-primary)]"
            />
            <button
              type="submit"
              className="rounded border border-red-500/60 px-3 py-1 text-sm text-red-400 hover:bg-red-500/10"
            >
              Reject page
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
