// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// cn — the tiny class-name joiner. Characterization: pins the exact observable
// behaviour (truthy filtering, ordering preserved, falsy values dropped, the
// caller `className` appended LAST so a consumer override wins by source order)
// before any refactor. This is the contract the shell primitives' `cn(...)` calls
// — and therefore the rendered DOM `class` attribute — depend on.
import { describe, expect, it } from "vitest";
import { cn } from "../src/lib/cn.js";

describe("cn", () => {
  it("joins truthy string values with a single space, in order", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops every falsy value (false, null, undefined, empty string, 0)", () => {
    expect(cn("a", false, null, undefined, "", 0, "b")).toBe("a b");
  });

  it("keeps the caller value LAST so a consumer override wins by source order", () => {
    // The shell calls `cn(<base utilities>, className)` — the appended caller
    // className must end up last in the string (later wins in the cascade).
    expect(cn("base-1 base-2", "caller-override")).toBe("base-1 base-2 caller-override");
  });

  it("includes numeric values (stringified by join)", () => {
    expect(cn("a", 1, "b")).toBe("a 1 b");
  });

  it("returns an empty string when given no (or only falsy) values", () => {
    expect(cn()).toBe("");
    expect(cn(false, null, undefined, "")).toBe("");
  });
});
