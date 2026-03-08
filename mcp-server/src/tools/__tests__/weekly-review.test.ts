import { describe, it, expect } from "vitest";
import { weeklyReview } from "../weekly-review.js";
import { createMockSupabase } from "./helpers.js";

describe("weeklyReview", () => {
  it("returns empty summary when no thoughts exist", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    const result = JSON.parse(await weeklyReview(mock.client, {}));

    expect(result.period_days).toBe(7);
    expect(result.total_thoughts).toBe(0);
    expect(result.by_type).toEqual({});
    expect(result.by_source).toEqual({});
    expect(result.people_mentioned).toEqual([]);
    expect(result.topics_mentioned).toEqual([]);
    expect(result.open_action_items).toEqual([]);
    expect(result.thoughts_by_type).toEqual({});
  });

  it("aggregates types and sources correctly", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { id: "1", raw_text: "note 1", thought_type: "note", source: "slack", people: null, topics: null, action_items: null, action_items_resolved: null, created_at: "2026-03-07T00:00:00Z" },
      { id: "2", raw_text: "note 2", thought_type: "note", source: "cli", people: null, topics: null, action_items: null, action_items_resolved: null, created_at: "2026-03-06T00:00:00Z" },
      { id: "3", raw_text: "decision", thought_type: "decision", source: "slack", people: null, topics: null, action_items: null, action_items_resolved: null, created_at: "2026-03-05T00:00:00Z" },
    ]);

    const result = JSON.parse(await weeklyReview(mock.client, {}));

    expect(result.total_thoughts).toBe(3);
    expect(result.by_type).toEqual({ note: 2, decision: 1 });
    expect(result.by_source).toEqual({ slack: 2, cli: 1 });
  });

  it("collects and deduplicates people and topics", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { id: "1", raw_text: "t1", thought_type: "note", source: "cli", people: ["Alice", "Bob"], topics: ["hiring"], action_items: null, action_items_resolved: null, created_at: "2026-03-07T00:00:00Z" },
      { id: "2", raw_text: "t2", thought_type: "note", source: "cli", people: ["Alice"], topics: ["hiring", "architecture"], action_items: null, action_items_resolved: null, created_at: "2026-03-06T00:00:00Z" },
    ]);

    const result = JSON.parse(await weeklyReview(mock.client, {}));

    expect(result.people_mentioned).toEqual(["Alice", "Bob"]);
    expect(result.topics_mentioned).toEqual(["architecture", "hiring"]);
  });

  it("identifies open action items", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([
      { id: "1", raw_text: "do stuff", thought_type: "action", source: "cli", people: null, topics: null, action_items: ["task A", "task B"], action_items_resolved: false, created_at: "2026-03-07T00:00:00Z" },
      { id: "2", raw_text: "done stuff", thought_type: "action", source: "cli", people: null, topics: null, action_items: ["task C"], action_items_resolved: true, created_at: "2026-03-06T00:00:00Z" },
    ]);

    const result = JSON.parse(await weeklyReview(mock.client, {}));

    expect(result.open_action_items).toHaveLength(1);
    expect(result.open_action_items[0]).toEqual({
      thought_id: "1",
      items: ["task A", "task B"],
    });
  });

  it("groups thoughts by type with truncated text", async () => {
    const mock = createMockSupabase();
    const longText = "x".repeat(200);
    mock.resolvesWith([
      { id: "1", raw_text: longText, thought_type: "note", source: "cli", people: null, topics: null, action_items: null, action_items_resolved: null, created_at: "2026-03-07T00:00:00Z" },
    ]);

    const result = JSON.parse(await weeklyReview(mock.client, {}));

    expect(result.thoughts_by_type.note).toHaveLength(1);
    expect(result.thoughts_by_type.note[0].text).toHaveLength(150);
  });

  it("respects custom days parameter", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith([]);

    const result = JSON.parse(await weeklyReview(mock.client, { days: 30 }));
    expect(result.period_days).toBe(30);
  });

  it("returns error on supabase failure", async () => {
    const mock = createMockSupabase();
    mock.resolvesWith(null, { message: "db error" });

    const result = JSON.parse(await weeklyReview(mock.client, {}));
    expect(result.error).toBe("db error");
  });
});
