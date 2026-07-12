import { describe, it, expect, beforeEach, vi } from "vitest";
import { listRecent } from "../list-recent.js";
import { createMockSupabase } from "./helpers.js";

beforeEach(() => {
  vi.stubEnv("OPEN_BRAIN_DEFAULT_PROJECT", "");
});

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

  function mockEq(mock: ReturnType<typeof createMockSupabase>) {
    return (mock.client as unknown as Record<string, ReturnType<typeof vi.fn>>).eq;
  }

  it("filters by project when project param is provided", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await listRecent(mock.client, { project: "my-project" });

    expect(mockEq(mock)).toHaveBeenCalledWith("project", "my-project");
  });

  it("uses OPEN_BRAIN_DEFAULT_PROJECT when project param is omitted", async () => {
    vi.stubEnv("OPEN_BRAIN_DEFAULT_PROJECT", "env-project");
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await listRecent(mock.client, {});

    expect(mockEq(mock)).toHaveBeenCalledWith("project", "env-project");
  });

  it("does not filter by project when neither param nor env var is set", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    await listRecent(mock.client, {});

    expect(mockEq(mock)).not.toHaveBeenCalled();
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
