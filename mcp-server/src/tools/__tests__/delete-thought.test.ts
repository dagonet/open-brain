import { describe, it, expect } from "vitest";
import { deleteThought } from "../delete-thought.js";
import { createMockSupabase } from "./helpers.js";

describe("deleteThought", () => {
  it("soft-deletes a thought successfully", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([{ id: "abc-123" }]);

    const result = JSON.parse(await deleteThought(mock.client, { id: "abc-123" }));

    expect(result.message).toBe("Thought soft-deleted successfully.");
    expect(result.id).toBe("abc-123");
  });

  it("reports when thought is not found", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    const result = JSON.parse(await deleteThought(mock.client, { id: "missing-id" }));

    expect(result.message).toBe("Thought not found or already deleted.");
    expect(result.id).toBe("missing-id");
  });

  it("reports when data is null", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null);

    const result = JSON.parse(await deleteThought(mock.client, { id: "null-case" }));

    expect(result.message).toBe("Thought not found or already deleted.");
  });

  it("returns error on supabase failure", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: "permission denied" });

    const result = JSON.parse(await deleteThought(mock.client, { id: "any" }));
    expect(result.error).toBe("permission denied");
  });
});
