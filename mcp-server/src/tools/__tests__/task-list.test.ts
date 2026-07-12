import { describe, it, expect, vi } from "vitest";
import { taskList } from "../task-list.js";
import { createMockSupabase } from "./helpers.js";

describe("taskList", () => {
  it("returns empty array when no tasks exist", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    const result = JSON.parse(await taskList(mock.client, {}));

    expect(result).toEqual([]);

    const m = mock.client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(m.from).toHaveBeenCalledWith("tasks");
  });

  it("filters by status", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      {
        id: "task-1",
        title: "Blocked task",
        status: "blocked",
        project: null,
        description: null,
        priority: null,
        linked_thought_ids: [],
        metadata: {},
        status_history: [],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = JSON.parse(await taskList(mock.client, { status: "blocked" }));

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Blocked task");

    const m = mock.client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(m.eq).toHaveBeenCalledWith("status", "blocked");
  });

  it("filters by project", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await taskList(mock.client, { project: "my-project" });

    const m = mock.client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(m.eq).toHaveBeenCalledWith("project", "my-project");
  });

  it("applies limit default of 50", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await taskList(mock.client, {});

    const m = mock.client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(m.limit).toHaveBeenCalledWith(50);
  });

  it("applies custom limit", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await taskList(mock.client, { limit: 10 });

    const m = mock.client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(m.limit).toHaveBeenCalledWith(10);
  });

  it("returns error on supabase query failure", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: "query failed" });

    const result = JSON.parse(await taskList(mock.client, {}));

    expect(result.error).toBe("query failed");
  });
});
