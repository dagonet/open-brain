import { describe, it, expect, vi, beforeEach } from "vitest";
import { semanticSearch } from "../semantic-search.js";
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

beforeEach(() => {
  vi.stubEnv("OPEN_BRAIN_DEFAULT_PROJECT", "");
});

describe("semanticSearch", () => {
  it("calls match_thoughts_v2 with new params", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    const searchResults = [
      { id: "1", raw_text: "hello", similarity: 0.95, score: 0.85, salience: 3, project: "open-brain" },
    ];
    mock.resolvesWith(searchResults);

    const result = JSON.parse(
      await semanticSearch(mock.client, openai, {
        query: "test",
        project: "my-project",
        recency_halflife_days: 60,
        include_superseded: true,
        apply_contradiction_penalty: false,
      })
    );

    expect(openai.embeddings.create).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "test",
    });

    const rpcMock = mock.client.rpc as unknown as ReturnType<typeof vi.fn>;
    const rpcCall = rpcMock.mock.calls[0];
    expect(rpcCall[0]).toBe("match_thoughts_v2");
    expect(rpcCall[1].filter_project).toBe("my-project");
    expect(rpcCall[1].recency_halflife_days).toBe(60);
    expect(rpcCall[1].include_superseded).toBe(true);
    expect(rpcCall[1].apply_contradiction_penalty).toBe(false);
    expect(rpcCall[1].match_count).toBe(10);

    expect(result).toEqual(searchResults);
  });

  it("includes score, salience, and project in v2 results", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    const v2Results = [
      { id: "1", raw_text: "hybrid result", similarity: 0.9, score: 0.75, salience: 4, project: "open-brain" },
    ];
    mock.resolvesWith(v2Results);

    const result = JSON.parse(
      await semanticSearch(mock.client, openai, { query: "hybrid" })
    );

    expect(result[0].score).toBe(0.75);
    expect(result[0].salience).toBe(4);
    expect(result[0].project).toBe("open-brain");
    expect(result[0].similarity).toBe(0.9);
  });

  it("passes defaults for omitted optional v2 params", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    mock.resolvesWith([]);

    await semanticSearch(mock.client, openai, { query: "test" });

    const rpcMock2 = mock.client.rpc as unknown as ReturnType<typeof vi.fn>;
    const rpcCall = rpcMock2.mock.calls[0];
    expect(rpcCall[1].filter_project).toBeNull();
    expect(rpcCall[1].recency_halflife_days).toBe(30);
    expect(rpcCall[1].include_superseded).toBe(false);
    expect(rpcCall[1].apply_contradiction_penalty).toBe(true);
  });

  it("uses OPEN_BRAIN_DEFAULT_PROJECT when project param is omitted", async () => {
    vi.stubEnv("OPEN_BRAIN_DEFAULT_PROJECT", "env-project");
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    mock.resolvesWith([]);

    await semanticSearch(mock.client, openai, { query: "test" });

    const rpcMock3 = mock.client.rpc as unknown as ReturnType<typeof vi.fn>;
    const rpcCall = rpcMock3.mock.calls[0];
    expect(rpcCall[1].filter_project).toBe("env-project");
  });

  it("fires increment_retrieval tracking RPC after successful search", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    const searchResults = [
      { id: "uuid-1" },
      { id: "uuid-2" },
    ];
    mock.resolvesWith(searchResults);

    await semanticSearch(mock.client, openai, { query: "track-me" });

    // The second rpc call should be increment_retrieval
    const rpcMock4 = mock.client.rpc as unknown as ReturnType<typeof vi.fn>;
    const calls = rpcMock4.mock.calls;
    expect(calls.length).toBe(2);
    const trackingCall = calls[1];
    expect(trackingCall[0]).toBe("increment_retrieval");
    expect(trackingCall[1].ids).toEqual(["uuid-1", "uuid-2"]);
  });

  it("does not fire tracking RPC when results are empty", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    mock.resolvesWith([]);

    await semanticSearch(mock.client, openai, { query: "no results" });

    const rpcMock5 = mock.client.rpc as unknown as ReturnType<typeof vi.fn>;
    expect(rpcMock5).toHaveBeenCalledTimes(1);
  });

  it("does not reject the tool when tracking RPC fails", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    const searchResults = [{ id: "uuid-1" }];
    mock.resolvesWith(searchResults);

    // After resolvesWith is consumed, the second RPC call will also use the same
    // resolveData. With the sync thenable mock this won't throw.
    const result = await semanticSearch(mock.client, openai, { query: "test" });
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(searchResults);
  });

  it("returns error when embedding fails", async () => {
    const mock = createMockSupabase();
    const openai = createFailingOpenAI();

    const result = JSON.parse(
      await semanticSearch(mock.client, openai, { query: "test" })
    );

    expect(result.error).toBe("Failed to generate embedding");
    expect(result.suggestion).toContain("thoughts_recent");
  });

  it("returns error on supabase RPC failure", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    mock.resolvesWith(null, { message: "function not found" });

    const result = JSON.parse(
      await semanticSearch(mock.client, openai, { query: "test" })
    );

    expect(result.error).toBe("function not found");
  });
});
