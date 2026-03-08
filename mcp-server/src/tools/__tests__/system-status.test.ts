import { describe, it, expect } from "vitest";
import { systemStatus } from "../system-status.js";
import { createMultiQueryMockSupabase } from "./helpers.js";

describe("systemStatus", () => {
  it("returns aggregated status", async () => {
    const { client } = createMultiQueryMockSupabase([
      // totalResult
      { data: null, count: 5 },
      // statusResult
      {
        data: [
          { processing_status: "complete" },
          { processing_status: "complete" },
          { processing_status: "partial" },
        ],
      },
      // sourceResult
      {
        data: [
          { source: "slack" },
          { source: "slack" },
          { source: "cli" },
        ],
      },
      // failuresResult
      { data: [] },
    ]);

    const result = JSON.parse(await systemStatus(client));

    expect(result.total_thoughts).toBe(5);
    expect(result.by_status.complete).toBe(2);
    expect(result.by_status.partial).toBe(1);
    expect(result.by_source.slack).toBe(2);
    expect(result.by_source.cli).toBe(1);
    expect(result.recent_failures).toEqual([]);
    expect(result.embedding_model).toBe("text-embedding-3-small");
    expect(result.embedding_dimensions).toBe(1536);
  });

  it("handles empty database", async () => {
    const { client } = createMultiQueryMockSupabase([
      { data: null, count: 0 },
      { data: [] },
      { data: [] },
      { data: [] },
    ]);

    const result = JSON.parse(await systemStatus(client));

    expect(result.total_thoughts).toBe(0);
    expect(result.by_status).toEqual({ complete: 0, partial: 0, failed: 0 });
    expect(result.by_source).toEqual({ slack: 0, cli: 0, mcp: 0 });
  });
});
