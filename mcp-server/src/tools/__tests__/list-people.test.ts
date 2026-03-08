import { describe, it, expect } from "vitest";
import { listPeople } from "../list-people.js";
import { createMockSupabase } from "./helpers.js";

describe("listPeople", () => {
  it("returns empty array when no thoughts have people", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    const result = JSON.parse(await listPeople(mock.client, {}));
    expect(result).toEqual([]);
  });

  it("aggregates people across multiple thoughts", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { people: ["Alice", "Bob"], created_at: "2026-03-01T00:00:00Z" },
      { people: ["Alice"], created_at: "2026-03-05T00:00:00Z" },
      { people: ["Charlie"], created_at: "2026-03-03T00:00:00Z" },
    ]);

    const result = JSON.parse(await listPeople(mock.client, {}));

    expect(result).toHaveLength(3);
    // Sorted by count DESC — Alice should be first
    expect(result[0]).toEqual({
      person: "Alice",
      count: 2,
      last_mentioned_at: "2026-03-05T00:00:00Z",
    });
    expect(result[1].person).toBe("Bob");
    expect(result[1].count).toBe(1);
    expect(result[2].person).toBe("Charlie");
  });

  it("respects limit parameter", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { people: ["Alice"], created_at: "2026-03-01T00:00:00Z" },
      { people: ["Bob"], created_at: "2026-03-02T00:00:00Z" },
      { people: ["Charlie"], created_at: "2026-03-03T00:00:00Z" },
    ]);

    const result = JSON.parse(await listPeople(mock.client, { limit: 2 }));
    expect(result).toHaveLength(2);
  });

  it("tracks the latest mention date per person", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { people: ["Alice"], created_at: "2026-03-01T00:00:00Z" },
      { people: ["Alice"], created_at: "2026-03-10T00:00:00Z" },
      { people: ["Alice"], created_at: "2026-03-05T00:00:00Z" },
    ]);

    const result = JSON.parse(await listPeople(mock.client, {}));
    expect(result[0].last_mentioned_at).toBe("2026-03-10T00:00:00Z");
  });

  it("returns error on supabase failure", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: "connection refused" });

    const result = JSON.parse(await listPeople(mock.client, {}));
    expect(result.error).toBe("connection refused");
  });

  it("handles null people arrays in rows gracefully", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { people: null, created_at: "2026-03-01T00:00:00Z" },
      { people: ["Alice"], created_at: "2026-03-02T00:00:00Z" },
    ]);

    const result = JSON.parse(await listPeople(mock.client, {}));
    expect(result).toHaveLength(1);
    expect(result[0].person).toBe("Alice");
  });
});
