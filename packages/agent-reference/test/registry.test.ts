// AUTHORED-BY Claude Opus 5.5
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE, BASELINE_SUITES, baselineRegistry } from "../src/suites/baseline.js";
import { LAYER_IDS, SuiteRegistry } from "../src/suites/registry.js";

const model = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/model.json"), "utf8"),
) as { layers: { id: string; suites: { id: string; baseline?: boolean }[] }[] };

describe("suite registry", () => {
  it("has exactly the model's layers, and the baseline is the model's baseline", () => {
    expect([...LAYER_IDS]).toEqual(model.layers.map((l) => l.id));
    for (const l of model.layers) {
      const baseline = l.suites.find((s) => s.baseline)?.id;
      expect(BASELINE.layers[l.id as (typeof LAYER_IDS)[number]]).toBe(baseline);
    }
  });

  it("accepts the baseline and reports every problem with an invalid configuration", () => {
    const r = baselineRegistry();
    expect(r.check(BASELINE)).toEqual([]);
    const { trust: _drop, ...rest } = BASELINE.layers;
    expect(r.check({ layers: { ...rest, extra: "x", transport: "a2a" } })).toEqual([
      { layer: "extra", problem: "unknown-layer" },
      { layer: "transport", problem: "unknown-suite", suite: "a2a" },
      { layer: "trust", problem: "missing" },
    ]);
    expect(r.check({ layers: { ...BASELINE.layers, identity: "jws" } })).toEqual([
      { layer: "identity", problem: "wrong-layer", suite: "jws" },
    ]);
  });

  it("applies suite constraints and never combines two configurations", () => {
    const r = baselineRegistry();
    r.register({
      ...BASELINE_SUITES["data-access"],
      id: "by-reference-solid",
      mode: "by-reference",
    });
    expect(
      r.check({ layers: { ...BASELINE.layers, "data-access": "by-reference-solid" } }),
    ).toEqual([expect.objectContaining({ layer: "data-access", problem: "constraint" })]);
    expect(() => r.configure(BASELINE)).toThrow(/already registered/);
    expect(() => r.register(BASELINE_SUITES.transport)).toThrow(/already registered/);
    expect(() => new SuiteRegistry().configure(BASELINE)).toThrow(/invalid/);
    expect(r.settle(["baseline"], ["other", "baseline"])?.id).toBe("baseline");
    expect(r.settle(["baseline"], ["other"])).toBeUndefined();
    expect(r.configurationOfMessage({ configuration: BASELINE.pilotConfiguration })?.id).toBe(
      "baseline",
    );
    expect(r.refs(BASELINE, ["trust"])).toEqual([{ layer: "trust", suite: "register-chain" }]);
    expect(r.suitesFor("transport").map((s) => s.id)).toEqual(["direct-http"]);
  });
});
