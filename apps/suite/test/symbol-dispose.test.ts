// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { ensureDisposeSymbols } from "../src/lib/symbol-dispose";

describe("ensureDisposeSymbols", () => {
  it("defines registered disposal symbols on an engine that lacks them", () => {
    const fake = {} as SymbolConstructor;
    ensureDisposeSymbols(fake);
    expect(fake.dispose).toBe(Symbol.for("Symbol.dispose"));
    expect(fake.asyncDispose).toBe(Symbol.for("Symbol.asyncDispose"));
    expect(Object.keys(fake)).toEqual([]);
    ensureDisposeSymbols(fake);
    expect(fake.dispose).toBe(Symbol.for("Symbol.dispose"));
  });

  it("leaves built-in disposal symbols untouched", () => {
    const dispose = Symbol("builtin dispose");
    const asyncDispose = Symbol("builtin asyncDispose");
    const fake = { dispose, asyncDispose } as unknown as SymbolConstructor;
    ensureDisposeSymbols(fake);
    expect(fake.dispose).toBe(dispose);
    expect(fake.asyncDispose).toBe(asyncDispose);
  });
});
