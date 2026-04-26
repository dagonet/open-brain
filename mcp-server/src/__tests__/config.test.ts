import { describe, it, expect } from "vitest";
import { disabledFamilies, familyForToolName } from "../config.js";

describe("disabledFamilies", () => {
  it("returns an empty set when env var is undefined", () => {
    const result = disabledFamilies(undefined);
    expect(result.size).toBe(0);
  });

  it("returns an empty set when env var is empty string", () => {
    const result = disabledFamilies("");
    expect(result.size).toBe(0);
  });

  it("parses a single family", () => {
    const result = disabledFamilies("wiki");
    expect(result.has("wiki")).toBe(true);
    expect(result.has("contradictions")).toBe(false);
  });

  it("parses comma-separated families", () => {
    const result = disabledFamilies("wiki,contradictions");
    expect(result.has("wiki")).toBe(true);
    expect(result.has("contradictions")).toBe(true);
  });

  it("trims whitespace", () => {
    const result = disabledFamilies("  wiki  ,  contradictions  ");
    expect(result.has("wiki")).toBe(true);
    expect(result.has("contradictions")).toBe(true);
  });

  it("ignores unknown family names", () => {
    const result = disabledFamilies("wiki,bogus,thoughts");
    expect(result.has("wiki")).toBe(true);
    expect(result.size).toBe(1);
  });

  it("is case-insensitive", () => {
    const result = disabledFamilies("WIKI,Contradictions");
    expect(result.has("wiki")).toBe(true);
    expect(result.has("contradictions")).toBe(true);
  });
});

describe("familyForToolName", () => {
  it("identifies wiki family", () => {
    expect(familyForToolName("wiki_get")).toBe("wiki");
    expect(familyForToolName("wiki_refresh")).toBe("wiki");
  });

  it("identifies contradictions family", () => {
    expect(familyForToolName("contradictions_list")).toBe("contradictions");
    expect(familyForToolName("contradictions_audit")).toBe("contradictions");
  });

  it("returns null for core tools", () => {
    expect(familyForToolName("thoughts_search")).toBe(null);
    expect(familyForToolName("system_status")).toBe(null);
    expect(familyForToolName("thoughts_capture")).toBe(null);
  });
});
