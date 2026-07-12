import { describe, it, expect, vi } from "vitest";
import { thoughtsSearchExpanded } from "../thoughts-search-expanded.js";
import { createMockSupabase } from "./helpers.js";
import type OpenAI from "openai";

function createMockOpenAI(embedding: number[] = [0.1, 0.2, 0.3]) {
  return {
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding }],
      }),
    },
  } as unknown as OpenAI;
}

function createFailingOpenAI() {
  return {
    embeddings: {
      create: vi.fn().mockRejectedValue(new Error("API key invalid")),
    },
  } as unknown as OpenAI;
}

describe("thoughtsSearchExpanded", () => {
  it("returns base results and expansion results when both succeed", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    const baseResults = [
      { id: "uuid-1", raw_text: "first thought", score: 0.95 },
    ];
    const expansionResults = [
      { thought_id: "uuid-2", raw_text: "related thought", score: 0.7 },
    ];

    // Override rpc: match_thoughts_v2, base tracking, related v3, expansion tracking
    const rpcMock = vi
      .fn()
      .mockResolvedValueOnce({ data: baseResults, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: expansionResults, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mock.client.rpc = rpcMock;

    const result = JSON.parse(
      await thoughtsSearchExpanded(mock.client, openai, {
        query: "test",
      }),
    );

    expect(result.results).toEqual(baseResults);
    expect(result.related_via_entities).toEqual(expansionResults);
  });

  it("returns base results with empty expansion when expansion RPC errors", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    const baseResults = [
      { id: "uuid-1", raw_text: "first thought", score: 0.95 },
    ];

    const rpcMock = vi
      .fn()
      .mockResolvedValueOnce({ data: baseResults, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "expansion failed" },
      });
    mock.client.rpc = rpcMock;

    const result = JSON.parse(
      await thoughtsSearchExpanded(mock.client, openai, {
        query: "test",
      }),
    );

    expect(result.results).toEqual(baseResults);
    expect(result.related_via_entities).toEqual([]);
  });

  it("returns base results with empty expansion when expansion returns nothing", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    const baseResults = [
      { id: "uuid-1", raw_text: "first thought", score: 0.95 },
    ];

    const rpcMock = vi
      .fn()
      .mockResolvedValueOnce({ data: baseResults, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mock.client.rpc = rpcMock;

    const result = JSON.parse(
      await thoughtsSearchExpanded(mock.client, openai, {
        query: "test",
      }),
    );

    expect(result.results).toEqual(baseResults);
    expect(result.related_via_entities).toEqual([]);
  });

  it("returns error when base search fails", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();

    const rpcMock = vi.fn().mockResolvedValueOnce({
      data: null,
      error: { message: "match_thoughts_v2 not found" },
    });
    mock.client.rpc = rpcMock;

    const result = JSON.parse(
      await thoughtsSearchExpanded(mock.client, openai, {
        query: "test",
      }),
    );

    expect(result.error).toBe("match_thoughts_v2 not found");
    // Expansion should NOT have been attempted
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("returns error when embedding generation fails (base search not attempted)", async () => {
    const mock = createMockSupabase();
    const openai = createFailingOpenAI();

    // Ensure rpc is never called
    mock.client.rpc = vi.fn();

    const result = JSON.parse(
      await thoughtsSearchExpanded(mock.client, openai, {
        query: "test",
      }),
    );

    expect(result.error).toBe("API key invalid");
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("passes project filter to match_thoughts_v2", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();

    const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null });
    mock.client.rpc = rpcMock;

    await thoughtsSearchExpanded(mock.client, openai, {
      query: "test",
      project: "my-project",
    });

    expect(rpcMock).toHaveBeenCalledWith("match_thoughts_v2", expect.objectContaining({
      filter_project: "my-project",
    }));
  });

  it("passes seed_thought_ids from base results to related_thoughts_via_entities", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    const baseResults = [
      { id: "uuid-1", raw_text: "a", score: 0.9 },
      { id: "uuid-2", raw_text: "b", score: 0.8 },
    ];

    const rpcMock = vi
      .fn()
      .mockResolvedValueOnce({ data: baseResults, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    mock.client.rpc = rpcMock;

    await thoughtsSearchExpanded(mock.client, openai, {
      query: "test",
    });

    expect(rpcMock).toHaveBeenCalledWith("related_thoughts_via_entities", {
      seed_thought_ids: ["uuid-1", "uuid-2"],
      result_limit: 10,
      max_entity_degree: 20,
    });
  });

  it("uses default limit of 10 for match_count and result_limit", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();

    const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null });
    mock.client.rpc = rpcMock;

    await thoughtsSearchExpanded(mock.client, openai, {
      query: "test",
    });

    expect(rpcMock).toHaveBeenCalledWith("match_thoughts_v2", expect.objectContaining({
      match_count: 10,
    }));
  });

  it("accepts custom limit parameter", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();

    const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null });
    mock.client.rpc = rpcMock;

    await thoughtsSearchExpanded(mock.client, openai, {
      query: "test",
      limit: 25,
    });

    expect(rpcMock).toHaveBeenCalledWith("match_thoughts_v2", expect.objectContaining({
      match_count: 25,
    }));
  });
});
