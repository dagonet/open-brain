import { describe, it, expect } from "vitest";
import { deriveFunctionsBase } from "../brain.js";

describe("deriveFunctionsBase", () => {
  it("extracts the functions base from a capture-thought URL", () => {
    expect(
      deriveFunctionsBase(
        "https://myproject.supabase.co/functions/v1/capture-thought",
      ),
    ).toBe("https://myproject.supabase.co/functions/v1");
  });

  it("works with project refs containing hyphens", () => {
    expect(
      deriveFunctionsBase(
        "https://my-cool-project.supabase.co/functions/v1/capture-thought",
      ),
    ).toBe("https://my-cool-project.supabase.co/functions/v1");
  });

  it("throws for non-Supabase URLs", () => {
    expect(() =>
      deriveFunctionsBase("https://example.com/api/thoughts"),
    ).toThrow("Cannot derive functions base from BRAIN_API_URL");
  });

  it("throws for malformed URLs", () => {
    expect(() => deriveFunctionsBase("not-a-url")).toThrow(
      "Cannot derive functions base from BRAIN_API_URL",
    );
  });
});
