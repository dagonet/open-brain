import { describe, it, expect, vi } from "vitest";
import { taskCreate } from "../task-create.js";
import { createMockSupabase } from "./helpers.js";

describe("taskCreate", () => {
  it("inserts a task with all fields and returns the created row", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith({
      id: "task-uuid",
      title: "Test task",
      description: "A description",
      priority: 3,
      project: "test-project",
      linked_thought_ids: [],
      metadata: {},
      status: "open",
      status_history: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    });

    const result = JSON.parse(
      await taskCreate(mock.client, {
        title: "Test task",
        description: "A description",
        priority: 3,
        project: "test-project",
        linked_thought_ids: [],
        metadata: {},
      }),
    );

    expect(result.id).toBe("task-uuid");
    expect(result.title).toBe("Test task");
    expect(result.status).toBe("open");

    const m = mock.client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(m.from).toHaveBeenCalledWith("tasks");
    expect(m.insert).toHaveBeenCalledWith({
      title: "Test task",
      description: "A description",
      priority: 3,
      project: "test-project",
      linked_thought_ids: [],
      metadata: {},
    });
  });

  it("inserts a task with only required title", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith({
      id: "task-uuid",
      title: "Minimal task",
      description: null,
      priority: null,
      project: null,
      linked_thought_ids: [],
      metadata: {},
      status: "open",
      status_history: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    });

    const result = JSON.parse(await taskCreate(mock.client, { title: "Minimal task" }));

    expect(result.title).toBe("Minimal task");
    expect(result.status).toBe("open");

    const m = mock.client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(m.insert).toHaveBeenCalledWith({
      title: "Minimal task",
      description: null,
      priority: null,
      project: null,
      linked_thought_ids: [],
      metadata: {},
    });
  });

  it("returns error when title is empty", async () => {
    const mock = createMockSupabase();

    const result = JSON.parse(await taskCreate(mock.client, { title: "" }));

    expect(result.error).toBe("title is required and must be non-empty.");

    const m = mock.client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(m.from).not.toHaveBeenCalled();
  });

  it("returns error on supabase insert failure", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: "insert failed" });

    const result = JSON.parse(await taskCreate(mock.client, { title: "Will fail" }));

    expect(result.error).toBe("insert failed");
  });
});
