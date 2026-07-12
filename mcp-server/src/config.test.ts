import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveProject } from "./config.js";

beforeEach(() => {
  vi.stubEnv("OPEN_BRAIN_DEFAULT_PROJECT", "");
});

describe("resolveProject", () => {
  it("returns explicit param when provided", () => {
    expect(resolveProject("my-project")).toBe("my-project");
  });

  it("returns OPEN_BRAIN_DEFAULT_PROJECT when no explicit param", () => {
    vi.stubEnv("OPEN_BRAIN_DEFAULT_PROJECT", "env-project");
    expect(resolveProject(null)).toBe("env-project");
    expect(resolveProject(undefined)).toBe("env-project");
  });

  it("returns null when neither param nor env var is set", () => {
    expect(resolveProject(null)).toBeNull();
    expect(resolveProject(undefined)).toBeNull();
  });

  it("explicit param overrides env var", () => {
    vi.stubEnv("OPEN_BRAIN_DEFAULT_PROJECT", "env-project");
    expect(resolveProject("explicit")).toBe("explicit");
    expect(resolveProject("explicit")).not.toBe("env-project");
  });

  it("returns null when env var is empty string", () => {
    vi.stubEnv("OPEN_BRAIN_DEFAULT_PROJECT", "");
    expect(resolveProject(null)).toBeNull();
  });
});
