// AUTHORED-BY Claude Fable 5
//
// Unit tests for the pristine-fetch anchor (./src/pristine.ts) — the mechanism
// that makes the login-stall deadlock unrepresentable (the brand chain +
// bounded unwrap). The end-to-end behaviour is covered by login-stall.test.ts;
// these pin the primitive's edge cases.
import { describe, expect, it } from "vitest";
import { brandFetchWrapper, PRISTINE_BASE, resolvePristineFetch } from "../src/pristine.js";

const stubFetch = (): typeof fetch => (async () => new Response("ok")) as unknown as typeof fetch;

describe("brandFetchWrapper / resolvePristineFetch", () => {
  it("recovers the base from a branded wrapper", () => {
    const base = stubFetch();
    const wrapper = brandFetchWrapper(stubFetch(), base);
    expect(resolvePristineFetch(wrapper)).toBe(base);
  });

  it("walks a CHAIN of branded wrappers back to the pristine base", () => {
    const base = stubFetch();
    const w1 = brandFetchWrapper(stubFetch(), base);
    const w2 = brandFetchWrapper(stubFetch(), w1);
    const w3 = brandFetchWrapper(stubFetch(), w2);
    expect(resolvePristineFetch(w3)).toBe(base);
  });

  it("returns an unbranded (foreign / native) fetch unchanged", () => {
    const foreign = stubFetch();
    expect(resolvePristineFetch(foreign)).toBe(foreign);
  });

  it("the brand is non-enumerable (never leaks into spreads / serialisation)", () => {
    const wrapper = brandFetchWrapper(stubFetch(), stubFetch());
    expect(Object.keys(wrapper)).toEqual([]);
    expect(Object.getOwnPropertySymbols(wrapper)).toContain(PRISTINE_BASE);
  });

  it("uses the GLOBAL symbol registry so cross-bundle copies unwrap each other", () => {
    expect(PRISTINE_BASE).toBe(Symbol.for("@jeswr/solid-auth-core:pristine-base"));
  });

  it("a cyclic brand chain terminates (bounded unwrap, never spins)", () => {
    const a = stubFetch();
    const b = stubFetch();
    brandFetchWrapper(a, b);
    brandFetchWrapper(b, a);
    // Either endpoint is acceptable — the property under test is termination.
    const resolved = resolvePristineFetch(a);
    expect(resolved === a || resolved === b).toBe(true);
  });

  it("a frozen wrapper degrades safely (stays unbranded, unwrap passes it through)", () => {
    const frozen = Object.freeze(stubFetch());
    const returned = brandFetchWrapper(frozen, stubFetch());
    expect(returned).toBe(frozen);
    expect(resolvePristineFetch(frozen)).toBe(frozen);
  });
});
