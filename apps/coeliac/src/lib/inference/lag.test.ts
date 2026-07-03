// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { EVIDENCE_PRIOR_LAG } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import { HOUR_MS, lagHours, onsetWithinLag, resolveAllLags, resolveLag } from "./lag";
import { at, triggerClass } from "./testUtils";

describe("resolveLag", () => {
  it("falls back to the model evidence prior when no per-user class is supplied", () => {
    const lag = resolveLag("gluten");
    expect(lag.lagWindowMin).toBe(EVIDENCE_PRIOR_LAG.gluten.lagWindowMin);
    expect(lag.lagWindowMax).toBe(EVIDENCE_PRIOR_LAG.gluten.lagWindowMax);
    expect(lag.lagMode).toBe(EVIDENCE_PRIOR_LAG.gluten.lagMode);
  });

  it("prefers a valid per-user profile over the prior", () => {
    const lag = resolveLag("gluten", [triggerClass("gluten", { min: 1, max: 10, mode: 4 })]);
    expect(lag.lagWindowMin).toBe(1);
    expect(lag.lagWindowMax).toBe(10);
  });

  it("rejects an INVALID per-user profile (unordered/negative) and uses the prior (fail-closed)", () => {
    // max < min — a garbled/hostile profile must never corrupt lag attribution.
    const bad = { slug: "lactose" as const, lagWindowMin: 9, lagWindowMax: 1, lagMode: 5 };
    const lag = resolveLag("lactose", [bad]);
    expect(lag.lagWindowMin).toBe(EVIDENCE_PRIOR_LAG.lactose.lagWindowMin);
    expect(lag.lagWindowMax).toBe(EVIDENCE_PRIOR_LAG.lactose.lagWindowMax);
  });

  it("uses per-trigger windows (gluten wide, lactose tight) — never one global window", () => {
    const g = resolveLag("gluten");
    const l = resolveLag("lactose");
    expect(g.lagWindowMax).toBeGreaterThan(l.lagWindowMax * 5); // 72 vs 6
  });

  it("resolveAllLags covers every requested trigger", () => {
    const map = resolveAllLags(undefined, ["gluten", "lactose", "sulphites"]);
    expect([...map.keys()].sort()).toEqual(["gluten", "lactose", "sulphites"]);
  });
});

describe("onsetWithinLag — boundary matrix", () => {
  const lag = { trigger: "gluten" as const, lagWindowMin: 2, lagWindowMax: 10, lagMode: 4 };
  const ingested = at(0);

  it("includes the exact lower boundary (delta === lagMin)", () => {
    expect(onsetWithinLag(ingested, at(2), lag)).toBe(true);
  });
  it("includes the exact upper boundary (delta === lagMax)", () => {
    expect(onsetWithinLag(ingested, at(10), lag)).toBe(true);
  });
  it("excludes just before the lower boundary", () => {
    expect(onsetWithinLag(ingested, new Date(at(2).getTime() - 1), lag)).toBe(false);
  });
  it("excludes just after the upper boundary", () => {
    expect(onsetWithinLag(ingested, new Date(at(10).getTime() + 1), lag)).toBe(false);
  });
  it("excludes an onset BEFORE ingestion (negative lag)", () => {
    expect(onsetWithinLag(ingested, at(-1), lag)).toBe(false);
  });
});

describe("lagHours", () => {
  it("computes the hour delta", () => {
    expect(lagHours(at(0), at(6.5))).toBeCloseTo(6.5, 10);
    expect(HOUR_MS).toBe(3_600_000);
  });
});
