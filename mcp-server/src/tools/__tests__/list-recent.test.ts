import { describe, it, expect } from "vitest";
import { listRecent } from "../list-recent.js";
import { createMockSupabase } from "./helpers.js";

describe("listRecent", () => {
  it("returns thoughts ordered by date", async () => {
    const mock = createMockSupabase();
    const thoughts = [
      { id: "1", raw_text: "recent", created_at: "2026-03-07T00:00:00Z" },
      { id: "2", raw_text: "older", created_at: "2026-03-01T00:00:00Z" },
    ];
    mock.resolvesWith(thoughts);

    const result = JSON.parse(await listRecent(mock.client, {}));
    expect(result).toEqual(thoughts);
  });

  it("returns empty array when no thoughts", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    const result = JSON.parse(await listRecent(mock.client, {}));
    expect(result).toEqual([]);
  });

  it("returns error on supabase failure", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: "connection error" });

    const result = JSON.parse(await listRecent(mock.client, {}));
    expect(result.error).toBe("connection error");
  });
});
