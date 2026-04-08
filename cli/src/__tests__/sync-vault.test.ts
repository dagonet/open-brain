import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  derivePostgrestUrl,
  thoughtToFilename,
  slugify,
  computeTitle,
  thoughtToMarkdown,
} from "../brain.js";

function makeThought(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    raw_text: "We decided to use pgvector for vector similarity search",
    thought_type: "decision",
    people: ["dirk", "sarah"],
    topics: ["pgvector", "architecture"],
    action_items: ["Review embedding dimensions"],
    action_items_resolved: false,
    source: "mcp",
    metadata: {},
    created_at: "2026-03-04T14:30:00Z",
    updated_at: "2026-03-04T14:30:00Z",
    ...overrides,
  };
}

describe("derivePostgrestUrl", () => {
  it("extracts PostgREST URL from standard Supabase function URL", () => {
    const url = "https://myproject.supabase.co/functions/v1/capture-thought";
    expect(derivePostgrestUrl(url)).toBe(
      "https://myproject.supabase.co/rest/v1/thoughts",
    );
  });

  it("works with project refs containing hyphens", () => {
    const url = "https://my-cool-project.supabase.co/functions/v1/capture-thought";
    expect(derivePostgrestUrl(url)).toBe(
      "https://my-cool-project.supabase.co/rest/v1/thoughts",
    );
  });

  it("throws for non-Supabase URLs", () => {
    expect(() => derivePostgrestUrl("https://example.com/api/thoughts")).toThrow(
      "Cannot derive PostgREST URL from BRAIN_API_URL",
    );
  });

  it("throws for malformed URLs", () => {
    expect(() => derivePostgrestUrl("not-a-url")).toThrow(
      "Cannot derive PostgREST URL from BRAIN_API_URL",
    );
  });
});

describe("slugify", () => {
  it("converts text to lowercase slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces non-alphanumeric runs with single dash", () => {
    expect(slugify("foo --- bar!!! baz")).toBe("foo-bar-baz");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("!!!hello!!!")).toBe("hello");
  });

  it("truncates to maxLen before slugifying", () => {
    const long = "A very long thought that exceeds the fifty character maximum length limit for slugs";
    const slug = slugify(long, 50);
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it("uses first line only", () => {
    expect(slugify("First line\nSecond line")).toBe("first-line");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

describe("thoughtToFilename", () => {
  it("generates date-prefixed slug filename", () => {
    const thought = makeThought();
    // "We decided to use pgvector for vector similarity search" truncated to 50 chars
    expect(thoughtToFilename(thought)).toBe(
      "2026-03-04-we-decided-to-use-pgvector-for-vector-similarity-s.md",
    );
  });

  it("handles different dates", () => {
    const thought = makeThought({
      created_at: "2025-12-31T23:59:59Z",
    });
    expect(thoughtToFilename(thought)).toBe(
      "2025-12-31-we-decided-to-use-pgvector-for-vector-similarity-s.md",
    );
  });

  it("produces unique filenames for different thoughts on same date", () => {
    const t1 = makeThought({ raw_text: "First thought" });
    const t2 = makeThought({ raw_text: "Second thought" });
    expect(thoughtToFilename(t1)).not.toBe(thoughtToFilename(t2));
  });

  it("appends suffix on collision when using Set tracking", () => {
    const usedNames = new Set<string>();
    const t1 = makeThought({ raw_text: "Same text" });
    const t2 = makeThought({ raw_text: "Same text" });
    const name1 = thoughtToFilename(t1, usedNames);
    const name2 = thoughtToFilename(t2, usedNames);
    expect(name1).toBe("2026-03-04-same-text.md");
    expect(name2).toBe("2026-03-04-same-text-2.md");
  });

  it("increments suffix for multiple collisions", () => {
    const usedNames = new Set<string>();
    const make = () => makeThought({ raw_text: "Duplicate" });
    const name1 = thoughtToFilename(make(), usedNames);
    const name2 = thoughtToFilename(make(), usedNames);
    const name3 = thoughtToFilename(make(), usedNames);
    expect(name1).toBe("2026-03-04-duplicate.md");
    expect(name2).toBe("2026-03-04-duplicate-2.md");
    expect(name3).toBe("2026-03-04-duplicate-3.md");
  });
});

describe("computeTitle", () => {
  it("returns full text when under 80 chars", () => {
    expect(computeTitle("Short thought")).toBe("Short thought");
  });

  it("truncates at 80 characters", () => {
    const longText = "A".repeat(100);
    const title = computeTitle(longText);
    expect(title).toHaveLength(80);
  });

  it("uses first line only for multiline text", () => {
    const text = "First line\nSecond line\nThird line";
    expect(computeTitle(text)).toBe("First line");
  });

  it("handles empty-ish text", () => {
    expect(computeTitle("Hi")).toBe("Hi");
  });
});

describe("thoughtToMarkdown", () => {
  it("generates valid YAML frontmatter", () => {
    const thought = makeThought();
    const md = thoughtToMarkdown(thought);
    expect(md).toMatch(/^---\n/);
    expect(md).toMatch(/\n---\n/);
  });

  it("includes all required frontmatter fields", () => {
    const thought = makeThought();
    const md = thoughtToMarkdown(thought);
    expect(md).toContain('id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"');
    expect(md).toContain('type: "decision"');
    expect(md).toContain('source: "mcp"');
    expect(md).toContain('created: "2026-03-04T14:30:00Z"');
  });

  it("includes people as wikilinks in body", () => {
    const thought = makeThought();
    const md = thoughtToMarkdown(thought);
    expect(md).toContain("[[Dirk]]");
    expect(md).toContain("[[Sarah]]");
    expect(md).toContain("**People:**");
  });

  it("generates correct tags (open-brain/type + topics)", () => {
    const thought = makeThought();
    const md = thoughtToMarkdown(thought);
    expect(md).toContain('"open-brain/decision"');
    expect(md).toContain('"pgvector"');
    expect(md).toContain('"architecture"');
  });

  it("includes action_items when present", () => {
    const thought = makeThought();
    const md = thoughtToMarkdown(thought);
    expect(md).toContain("action_items:");
    expect(md).toContain('"Review embedding dimensions"');
    expect(md).toContain("action_items_resolved: false");
  });

  it("omits action_items when empty", () => {
    const thought = makeThought({ action_items: [] });
    const md = thoughtToMarkdown(thought);
    expect(md).not.toContain("action_items:");
    expect(md).not.toContain("action_items_resolved:");
  });

  it("omits people wikilinks when no people", () => {
    const thought = makeThought({ people: [] });
    const md = thoughtToMarkdown(thought);
    expect(md).not.toContain("**People:**");
    expect(md).not.toContain("[[");
  });

  it("includes raw_text in body", () => {
    const thought = makeThought();
    const md = thoughtToMarkdown(thought);
    expect(md).toContain(thought.raw_text);
  });

  it("defaults type to note when thought_type is null", () => {
    const thought = makeThought({ thought_type: null });
    const md = thoughtToMarkdown(thought);
    expect(md).toContain('type: "note"');
  });
});

describe("hash-based skip logic", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sync-vault-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("detects unchanged content via SHA-256 hash", () => {
    const thought = makeThought();
    const markdown = thoughtToMarkdown(thought);
    const filePath = join(tempDir, thoughtToFilename(thought));

    // Write the file
    writeFileSync(filePath, markdown, "utf-8");

    // Generate hash of new content
    const newHash = createHash("sha256").update(markdown).digest("hex");
    // Read existing and hash
    const existingHash = createHash("sha256")
      .update(readFileSync(filePath, "utf-8"))
      .digest("hex");

    expect(newHash).toBe(existingHash);
  });

  it("detects changed content", () => {
    const thought = makeThought();
    const filePath = join(tempDir, thoughtToFilename(thought));

    // Write old content
    writeFileSync(filePath, "old content", "utf-8");

    const markdown = thoughtToMarkdown(thought);
    const newHash = createHash("sha256").update(markdown).digest("hex");
    const existingHash = createHash("sha256")
      .update(readFileSync(filePath, "utf-8"))
      .digest("hex");

    expect(newHash).not.toBe(existingHash);
  });
});

describe("vault path creation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sync-vault-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("mkdirSync with recursive creates nested directories", () => {
    const nested = join(tempDir, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    // Should not throw, directory exists
    const thought = makeThought();
    const filePath = join(nested, thoughtToFilename(thought));
    writeFileSync(filePath, thoughtToMarkdown(thought), "utf-8");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("pgvector");
  });
});
