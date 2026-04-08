import { describe, it, expect } from "vitest";
import { listTopics } from "../list-topics.js";
import { createMockSupabase } from "./helpers.js";

describe("listTopics", () => {
  it("returns empty array when no thoughts have topics", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    const result = JSON.parse(await listTopics(mock.client, {}));
    expect(result).toEqual([]);
  });

  it("aggregates topics across multiple thoughts", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { topics: ["architecture", "hiring"], created_at: "2026-03-01T00:00:00Z" },
      { topics: ["architecture"], created_at: "2026-03-05T00:00:00Z" },
      { topics: ["testing"], created_at: "2026-03-03T00:00:00Z" },
    ]);

    const result = JSON.parse(await listTopics(mock.client, {}));

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      topic: "architecture",
      count: 2,
      last_mentioned_at: "2026-03-05T00:00:00Z",
    });
    expect(result[1].topic).toBe("hiring");
    expect(result[2].topic).toBe("testing");
  });

  it("respects limit parameter", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { topics: ["a"], created_at: "2026-03-01T00:00:00Z" },
      { topics: ["b"], created_at: "2026-03-02T00:00:00Z" },
      { topics: ["c"], created_at: "2026-03-03T00:00:00Z" },
    ]);

    const result = JSON.parse(await listTopics(mock.client, { limit: 1 }));
    expect(result).toHaveLength(1);
  });

  it("tracks the latest mention date per topic", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { topics: ["hiring"], created_at: "2026-03-01T00:00:00Z" },
      { topics: ["hiring"], created_at: "2026-03-10T00:00:00Z" },
      { topics: ["hiring"], created_at: "2026-03-05T00:00:00Z" },
    ]);

    const result = JSON.parse(await listTopics(mock.client, {}));
    expect(result[0].last_mentioned_at).toBe("2026-03-10T00:00:00Z");
  });

  it("returns error on supabase failure", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: "timeout" });

    const result = JSON.parse(await listTopics(mock.client, {}));
    expect(result.error).toBe("timeout");
  });

  it("handles null topics arrays gracefully", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { topics: null, created_at: "2026-03-01T00:00:00Z" },
      { topics: ["valid"], created_at: "2026-03-02T00:00:00Z" },
    ]);

    const result = JSON.parse(await listTopics(mock.client, {}));
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe("valid");
  });
});
