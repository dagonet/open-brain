import { describe, it, expect } from "vitest";
import { buildInstructions } from "../instructions.js";

describe("buildInstructions", () => {
  it("includes the core MUST keyword regardless of wiki/entities state", () => {
    const off = buildInstructions({ wikiEnabled: false, entitiesEnabled: false });
    const on = buildInstructions({ wikiEnabled: true, entitiesEnabled: false });
    expect(off).toContain("You MUST actively read from and write to it");
    expect(on).toContain("You MUST actively read from and write to it");
  });

  it("omits the wiki section when disabled", () => {
    const result = buildInstructions({ wikiEnabled: false, entitiesEnabled: false });
    expect(result).not.toContain("WIKI LAYER");
    expect(result).not.toContain("wiki_get");
    expect(result).not.toContain("contradictions_list");
  });

  it("includes the wiki section when enabled", () => {
    const result = buildInstructions({ wikiEnabled: true, entitiesEnabled: false });
    expect(result).toContain("WIKI LAYER");
    expect(result).toContain("wiki_list({limit:1})");
    expect(result).toContain("contradictions_list");
  });

  it("omits the entities section when disabled", () => {
    const result = buildInstructions({ wikiEnabled: false, entitiesEnabled: false });
    expect(result).not.toContain("ENTITIES ");
    expect(result).not.toContain("entities_search");
    expect(result).not.toContain("entities_graph");
  });

  it("includes the entities section when enabled", () => {
    const result = buildInstructions({ wikiEnabled: false, entitiesEnabled: true });
    expect(result).toContain("ENTITIES ");
    expect(result).toContain("entities_search");
    expect(result).toContain("entities_graph");
  });

  it("includes the inspiration citation in both modes", () => {
    const off = buildInstructions({ wikiEnabled: false, entitiesEnabled: false });
    const on = buildInstructions({ wikiEnabled: true, entitiesEnabled: false });
    expect(off).toContain("Andrej Karpathy");
    expect(off).toContain("Nate B Jones");
    expect(on).toContain("Andrej Karpathy");
    expect(on).toContain("Nate B Jones");
  });

  it("references the core thoughts_* tools", () => {
    const result = buildInstructions({ wikiEnabled: false, entitiesEnabled: false });
    expect(result).toContain("thoughts_search");
    expect(result).toContain("thoughts_capture");
    expect(result).toContain("thoughts_recent");
  });
});
