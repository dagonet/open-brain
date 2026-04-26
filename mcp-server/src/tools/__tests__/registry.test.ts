import { describe, it, expect } from "vitest";
import { allTools } from "../index.js";

describe("allTools registry", () => {
  it("has exactly 14 tool definitions", () => {
    expect(allTools).toHaveLength(14);
  });

  it("each tool has required fields", () => {
    for (const tool of allTools) {
      expect(tool.name).toBeTypeOf("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description).toBeTypeOf("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.schema).toBeTypeOf("object");
      expect(tool.handler).toBeTypeOf("function");
    }
  });

  it("has no duplicate names", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool name uses one of the known family prefixes", () => {
    const allowedPrefixes = ["thoughts_", "wiki_", "contradictions_"];
    const allowedExact = new Set(["system_status"]);
    for (const tool of allTools) {
      if (allowedExact.has(tool.name)) continue;
      const matches = allowedPrefixes.some((p) => tool.name.startsWith(p));
      expect(matches, `unexpected tool name: ${tool.name}`).toBe(true);
    }
  });

  it("contains the expected tool names", () => {
    const names = new Set(allTools.map((t) => t.name));
    expect(names).toEqual(
      new Set([
        // thoughts (8)
        "thoughts_search",
        "thoughts_recent",
        "thoughts_delete",
        "system_status",
        "thoughts_people",
        "thoughts_topics",
        "thoughts_review",
        "thoughts_capture",
        // wiki (3)
        "wiki_get",
        "wiki_list",
        "wiki_refresh",
        // contradictions (3)
        "contradictions_list",
        "contradictions_resolve",
        "contradictions_audit",
      ])
    );
  });
});
