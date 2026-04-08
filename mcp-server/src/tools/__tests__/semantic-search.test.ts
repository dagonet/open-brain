import { describe, it, expect, vi } from "vitest";
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

describe("semanticSearch", () => {
  it("embeds query and calls supabase RPC", async () => {
    const mock = createMockSupabase();
    const openai = createMockOpenAI();
    const searchResults = [{ id: "1", raw_text: "hello", similarity: 0.95 }];
    mock.resolvesWith(searchResults);

    const result = JSON.parse(
      await semanticSearch(mock.client, openai, { query: "test" })
    );

    expect(openai.embeddings.create).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "test",
    });
    expect(result).toEqual(searchResults);
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
