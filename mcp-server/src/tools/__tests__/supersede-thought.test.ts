import { describe, it, expect, vi } from "vitest";
import { supersedeThought } from "../supersede-thought.js";
import { createMockSupabase } from "./helpers.js";

describe("supersedeThought", () => {
  it("marks new thought as superseding old thought", async () => {
    const mock = createMockSupabase();
    // First query: both thoughts exist with lifecycle_status
    mock.resolvesWith([
      { id: "new-id", deleted_at: null, lifecycle_status: "active" },
      { id: "old-id", deleted_at: null, lifecycle_status: "active" },
    ]);

    const result = JSON.parse(
      await supersedeThought(mock.client, {
        new_thought_id: "new-id",
        old_thought_id: "old-id",
      }),
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain("new-id");
    expect(result.message).toContain("old-id");
    const m = mock.client as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    // First update: set supersedes_id on new thought
    expect(m.update).toHaveBeenCalledWith({ supersedes_id: "old-id" });
    expect(m.eq).toHaveBeenCalledWith("id", "new-id");
    // Second update: set lifecycle_status on old thought
    expect(m.update).toHaveBeenCalledWith({ lifecycle_status: "superseded" });
    expect(m.eq).toHaveBeenCalledWith("id", "old-id");
  });

  it("returns error when new_thought_id equals old_thought_id", async () => {
    const mock = createMockSupabase();

    const result = JSON.parse(
      await supersedeThought(mock.client, {
        new_thought_id: "same-id",
        old_thought_id: "same-id",
      }),
    );

    expect(result.error).toBe(
      "new_thought_id and old_thought_id must be different.",
    );
    const m2 = mock.client as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    expect(m2.from).not.toHaveBeenCalled();
  });

  it("returns error when one or both thoughts do not exist", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([{ id: "existing-guid", deleted_at: null }]);

    const result = JSON.parse(
      await supersedeThought(mock.client, {
        new_thought_id: "existing-guid",
        old_thought_id: "missing-guid",
      }),
    );

    expect(result.error).toBe("Thought(s) not found: missing-guid");
  });

  it("returns error when thought has been deleted", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { id: "new-id", deleted_at: null },
      { id: "old-id", deleted_at: "2026-01-01T00:00:00Z" },
    ]);

    const result = JSON.parse(
      await supersedeThought(mock.client, {
        new_thought_id: "new-id",
        old_thought_id: "old-id",
      }),
    );

    expect(result.error).toContain("deleted");
  });

  it("returns error when old thought is already superseded", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { id: "new-id", deleted_at: null, lifecycle_status: "active" },
      { id: "old-id", deleted_at: null, lifecycle_status: "superseded" },
    ]);

    const result = JSON.parse(
      await supersedeThought(mock.client, {
        new_thought_id: "new-id",
        old_thought_id: "old-id",
      }),
    );

    expect(result.error).toContain("already superseded");
  });

  it("returns error when old thought is archived", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { id: "new-id", deleted_at: null, lifecycle_status: "active" },
      { id: "old-id", deleted_at: null, lifecycle_status: "archived" },
    ]);

    const result = JSON.parse(
      await supersedeThought(mock.client, {
        new_thought_id: "new-id",
        old_thought_id: "old-id",
      }),
    );

    expect(result.error).toContain("archived");
  });

  it("returns error on supabase lookup failure", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: "connection error" });

    const result = JSON.parse(
      await supersedeThought(mock.client, {
        new_thought_id: "new-id",
        old_thought_id: "old-id",
      }),
    );

    expect(result.error).toBe("connection error");
  });

  it("returns error on supabase update failure", async () => {
    const mock = createMockSupabase();
    // Resolve lookup successfully, then update fails
    mock.resolvesWith([
      { id: "new-id", deleted_at: null },
      { id: "old-id", deleted_at: null },
    ]);

    // We need a second resolvesWith for the update path.
    // With the single-chain mock, we can patch the update mock to throw.
    // Instead, we need the update chain to return an error.
    // The mock builder always returns { data, error } from the current state.
    // So we set error state for the update:
    // Actually the chain has builder.then which uses the current resolvesWith state.
    // After the lookup (which consumed the GOOD state), we need the update path
    // to resolve with error. But since it's the same builder, we can't change
    // state between the lookup and the update.

    // Workaround: manually mock the update chain to return error
    const m3 = mock.client as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    const mockUpdate = m3.update;
    mockUpdate.mockImplementationOnce(() => {
      const chain: Record<string, unknown> = {};
      // Override .eq to return a chain that resolves with error
      chain.eq = vi.fn().mockImplementation(() => {
        const inner: Record<string, unknown> = {};
        inner.then = (resolve: (value: unknown) => void) => {
          resolve({ data: null, error: { message: "update failed" } });
        };
        return inner;
      });
      return chain;
    });

    const result = JSON.parse(
      await supersedeThought(mock.client, {
        new_thought_id: "new-id",
        old_thought_id: "old-id",
      }),
    );

    expect(result.error).toBe("update failed");
  });
});
