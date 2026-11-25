// AUTHORED-BY Claude Sonnet 5.5
import * as memory from "@jeswr/pkg-memory";
import { DataFactory as df } from "n3";
import { describe, expect, it } from "vitest";
import {
  HealthGraphError,
  importHealthExport,
  MAX_ENVELOPES_PER_IMPORTED_ASSERTION,
  MAX_IMPORT_NANOPUBLICATIONS,
  MAX_PROJECTED_FACTS,
  projectHealthFacts,
} from "../src/index.js";
import { assertWithinLimits } from "../src/limits.js";
import { batch, claim, H, owner } from "./helpers.js";

const tooLarge = new HealthGraphError("too-large");
const same = (count: number) =>
  Array.from({ length: count }, (_, i) => claim(`corroboration-${i}`));

describe("explicit work and output caps", () => {
  it("caps are consistent with the pkg-memory classifier", () => {
    expect(MAX_IMPORT_NANOPUBLICATIONS).toBe(memory.MAX_CLASSIFIED_NANOPUBLICATIONS);
    expect(MAX_ENVELOPES_PER_IMPORTED_ASSERTION).toBe(memory.MAX_ENVELOPES_PER_ASSERTION);
    expect(MAX_PROJECTED_FACTS).toBeGreaterThanOrEqual(MAX_IMPORT_NANOPUBLICATIONS);
  });

  it("imports exactly the per-assertion maximum of envelopes sharing one assertion", async () => {
    const value = await batch(same(MAX_ENVELOPES_PER_IMPORTED_ASSERTION));
    expect(new Set(value.nanopubs.map((np) => np.assertionId)).size).toBe(1);
    const imported = await importHealthExport(await memory.serializeNanopublications(value), {
      owner,
    });
    expect(imported.value.nanopubs).toHaveLength(MAX_ENVELOPES_PER_IMPORTED_ASSERTION);
    expect(projectHealthFacts(imported.value, { owner }).facts).toHaveLength(
      MAX_ENVELOPES_PER_IMPORTED_ASSERTION,
    );
  });

  it("refuses an import above the per-assertion maximum with a fixed error", async () => {
    const value = await batch(same(MAX_ENVELOPES_PER_IMPORTED_ASSERTION + 1));
    const text = await memory.serializeNanopublications(value);
    await expect(importHealthExport(text, { owner })).rejects.toThrow(tooLarge.message);
    await expect(importHealthExport(text, { owner })).rejects.toMatchObject({ code: "too-large" });
    // The projection of an already-parsed value of the same shape refuses too.
    expect(() => projectHealthFacts(value, { owner })).toThrow(tooLarge.message);
  });

  it("refuses more nanopublications than the total maximum, counting duplicates once", () => {
    const make = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `https://example.org/np/${i}`,
        assertionId: `https://example.org/assertion/${i}`,
      }));
    expect(() => assertWithinLimits(make(MAX_IMPORT_NANOPUBLICATIONS))).not.toThrow();
    expect(() =>
      assertWithinLimits([...make(MAX_IMPORT_NANOPUBLICATIONS), ...make(5)]),
    ).not.toThrow();
    expect(() => assertWithinLimits(make(MAX_IMPORT_NANOPUBLICATIONS + 1))).toThrow(
      tooLarge.message,
    );
  });

  it("stops a projection whose shared assertion carries too many subjects", async () => {
    const value = await batch([claim("one")]);
    const [np] = value.nanopubs;
    const extra = (count: number, from = 0) => {
      for (let i = from; i < from + count; i++)
        value.dataset.addQuad(
          df.namedNode(`https://example.org/entities/extra-${i}`),
          df.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
          df.namedNode(`${H}Condition`),
          df.namedNode(np?.assertionId as string),
        );
    };
    // One recognised condition already exists in the claim.
    extra(MAX_PROJECTED_FACTS - 1);
    expect(projectHealthFacts(value, { owner }).facts).toHaveLength(MAX_PROJECTED_FACTS);
    extra(1, MAX_PROJECTED_FACTS - 1);
    let thrown: unknown;
    try {
      projectHealthFacts(value, { owner });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HealthGraphError);
    expect(thrown).toMatchObject({ code: "too-large", message: tooLarge.message });
  }, 180_000);
});
