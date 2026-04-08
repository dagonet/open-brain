import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import type { Thought, SearchParams } from "@/lib/types";
import ThoughtCard from "@/components/ThoughtCard";
import SearchBar from "@/components/SearchBar";
import Sidebar from "@/components/Sidebar";
import Pagination from "@/components/Pagination";
import EmptyState from "@/components/EmptyState";

const PAGE_SIZE = 20;

interface PageProps {
  searchParams: Promise<SearchParams>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const supabase = await createClient();

  // Verify auth
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;

  const currentPage = Math.max(1, parseInt(params.page ?? "1", 10));

  // Build query
  let query = supabase
    .from("thoughts")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  // Text search
  if (params.q) {
    query = query.ilike("raw_text", `%${params.q}%`);
  }

  // Filters
  if (params.type) {
    query = query.eq("thought_type", params.type);
  }

  if (params.topic) {
    query = query.contains("topics", [params.topic]);
  }

  if (params.person) {
    query = query.contains("people", [params.person]);
  }

  // Cursor-based pagination for efficiency
  if (params.cursor && params.cursor_id && currentPage > 1) {
    query = query.or(
      `created_at.lt.${params.cursor},and(created_at.eq.${params.cursor},id.lt.${params.cursor_id})`
    );
  }

  query = query.limit(PAGE_SIZE);

  // If not using cursor (e.g. going backwards), fall back to offset
  if (!params.cursor && currentPage > 1) {
    query = query.range(
      (currentPage - 1) * PAGE_SIZE,
      currentPage * PAGE_SIZE - 1
    );
  }

  const { data: thoughts, count } = await query;

  const typedThoughts: Thought[] = (thoughts as Thought[]) ?? [];
  const totalCount = count ?? 0;
  const hasMore = currentPage * PAGE_SIZE < totalCount;

  // Cursor for next page
  const lastThought = typedThoughts[typedThoughts.length - 1];
  const nextCursor = lastThought?.created_at;
  const nextCursorId = lastThought?.id;

  // Fetch distinct topics, people, and types for filter dropdowns
  const [topicsResult, peopleResult, typesResult] = await Promise.all([
    supabase.rpc("get_distinct_topics").then((r) => r.data),
    supabase.rpc("get_distinct_people").then((r) => r.data),
    supabase
      .from("thoughts")
      .select("thought_type")
      .is("deleted_at", null)
      .not("thought_type", "is", null)
      .then((r) => {
        const types = new Set((r.data ?? []).map((d: { thought_type: string }) => d.thought_type));
        return Array.from(types).sort();
      }),
  ]);

  const topics: string[] = (topicsResult as string[]) ?? [];
  const people: string[] = (peopleResult as string[]) ?? [];
  const thoughtTypes: string[] = (typesResult as string[]) ?? [];

  const searchParamsRecord: Record<string, string | undefined> = {
    q: params.q,
    type: params.type,
    topic: params.topic,
    person: params.person,
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar totalThoughts={totalCount} />

      <main className="flex-1 p-6 md:p-8 md:ml-0">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-6">
            Dashboard
          </h2>

          <SearchBar
            topics={topics}
            people={people}
            thoughtTypes={thoughtTypes}
          />

          {typedThoughts.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-4">
              {typedThoughts.map((thought) => (
                <ThoughtCard key={thought.id} thought={thought} />
              ))}
            </div>
          )}

          {totalCount > PAGE_SIZE && (
            <Pagination
              currentPage={currentPage}
              hasMore={hasMore}
              cursor={nextCursor}
              cursorId={nextCursorId}
              searchParams={searchParamsRecord}
            />
          )}
        </div>
      </main>
    </div>
  );
}
