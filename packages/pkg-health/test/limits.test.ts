// AUTHORED-BY Claude Sonnet 5.5
import * as memory from "@jeswr/pkg-memory";
import { describe, expect, it } from "vitest";
import {
  HealthGraphError,
  importHealthExport,
  MAX_IMPORT_NANOPUBLICATIONS,
  MAX_PROJECTED_FACTS,
  projectHealthFacts,
} from "../src/index.js";
import { assertWithinLimits } from "../src/limits.js";
import { batch, claim, owner } from "./helpers.js";

const tooLarge = new HealthGraphError("too-large");

describe("read caps", () => {
  it("the nanopub cap matches pkg-memory's and the fact cap is not below it", () => {
    expect(MAX_IMPORT_NANOPUBLICATIONS).toBe(memory.MAX_CLASSIFIED_NANOPUBLICATIONS);
    expect(MAX_PROJECTED_FACTS).toBeGreaterThanOrEqual(MAX_IMPORT_NANOPUBLICATIONS);
  });

  it("never refuses a read because one assertion is stated by many envelopes", async () => {
    // Assertion IDs are content hashes: restating a fact always shares its assertion.
    const count = 150;
    const value = await batch(Array.from({ length: count }, (_, i) => claim(`restated-${i}`)));
    expect(new Set(value.nanopubs.map((np) => np.assertionId)).size).toBe(1);
    const imported = await importHealthExport(await memory.serializeNanopublications(value), {
      owner,
    });
    expect(imported.value.nanopubs).toHaveLength(count);
    const view = projectHealthFacts(imported.value, { owner });
    expect(view.facts).toHaveLength(count);
    expect(view.facts.every((fact) => fact.corroboration === count)).toBe(true);
    // Merging two such imports stays readable too.
    const merged = memory.mergeNanopublications(imported.value, imported.value);
    expect(projectHealthFacts(merged, { owner }).facts).toHaveLength(count);
  });

  it("refuses an export with too many heads before reading any graph, as too-large", async () => {
    const heads = Array.from(
      { length: MAX_IMPORT_NANOPUBLICATIONS + 1 },
      (_, i) => `<urn:h:${i}> { <urn:h:${i}> np:hasAssertion <urn:a:${i}> . }`,
    ).join("\n");
    const text = `@prefix np: <http://www.nanopub.org/nschema#> .\n${heads}`;
    await expect(importHealthExport(text, { owner })).rejects.toMatchObject({
      code: "too-large",
      message: tooLarge.message,
    });
  }, 60_000);

  it("refuses more nanopublications than the total maximum, counting duplicates once", () => {
    const make = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `https://example.org/np/${i}` }));
    expect(() => assertWithinLimits(make(MAX_IMPORT_NANOPUBLICATIONS))).not.toThrow();
    expect(() =>
      assertWithinLimits([...make(MAX_IMPORT_NANOPUBLICATIONS), ...make(5)]),
    ).not.toThrow();
    expect(() => assertWithinLimits(make(MAX_IMPORT_NANOPUBLICATIONS + 1))).toThrow(
      tooLarge.message,
    );
  });

  it("refuses to project a merged value above the total maximum, with the fixed error", async () => {
    const value = await batch([claim("one")]);
    const [np] = value.nanopubs;
    value.nanopubs = Array.from({ length: MAX_IMPORT_NANOPUBLICATIONS + 1 }, (_, i) => ({
      ...(np as memory.Nanopublication),
      id: `https://example.org/np/${i}`,
    }));
    expect(() => projectHealthFacts(value, { owner })).toThrow(tooLarge.message);
  });
});
