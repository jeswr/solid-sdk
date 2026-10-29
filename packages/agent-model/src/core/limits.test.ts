// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { assertJsonBounds, BoundsError, resolveLimits } from "./limits.js";

describe("JSON node allocation bounds", () => {
  it.each([
    false,
    true,
  ])("bounds object properties before reading children (nested: %s)", (nested) => {
    const read = vi.fn(() => null);
    const wide = Object.defineProperties(
      {},
      Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [index, { enumerable: true, get: read }]),
      ),
    );
    const value = nested ? { pending: null, wide } : wide;
    expect(() => assertJsonBounds(value, resolveLimits({ maxJsonNodes: 5 }))).toThrowError(
      expect.objectContaining({ code: "too-many-nodes" }),
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("reserves nodes already queued when expanding objects and arrays", () => {
    for (const wide of [{ a: null, b: null }, [null, null]]) {
      const read = vi.fn(() => null);
      Object.defineProperty(wide, "1", { enumerable: true, get: read });
      expect(() =>
        assertJsonBounds({ pending: null, wide }, resolveLimits({ maxJsonNodes: 4 })),
      ).toThrowError(expect.objectContaining({ code: "too-many-nodes" }));
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("accepts the exact node budget and ignores inherited object properties", () => {
    const value = { a: [null, { b: true }], c: "x" };
    expect(() => assertJsonBounds(value, resolveLimits({ maxJsonNodes: 6 }))).not.toThrow();
    expect(() => assertJsonBounds(value, resolveLimits({ maxJsonNodes: 5 }))).toThrow(BoundsError);
    const read = vi.fn(() => null);
    const prototype = Object.defineProperty({}, "inherited", { enumerable: true, get: read });
    expect(() =>
      assertJsonBounds(
        Object.assign(Object.create(prototype), { own: null }),
        resolveLimits({ maxJsonNodes: 2 }),
      ),
    ).not.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
});
