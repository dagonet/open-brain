import { describe, it, expect } from "vitest";
import { allTools } from "../index.js";

describe("allTools registry", () => {
  it("has exactly 8 tool definitions", () => {
    expect(allTools).toHaveLength(8);
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

  it("all thoughts-domain tools use thoughts_ prefix", () => {
    const nonSystem = allTools.filter((t) => t.name !== "system_status");
    for (const tool of nonSystem) {
      expect(tool.name).toMatch(/^thoughts_/);
    }
  });

  it("contains the expected tool names", () => {
    const names = new Set(allTools.map((t) => t.name));
    expect(names).toEqual(
      new Set([
        "thoughts_search",
        "thoughts_recent",
        "thoughts_delete",
        "system_status",
        "thoughts_people",
        "thoughts_topics",
        "thoughts_review",
        "thoughts_capture",
      ])
    );
  });
});
