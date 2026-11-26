// AUTHORED-BY Claude Sonnet 5.5
import { DataFactory as df } from "n3";
import { describe, expect, it, vi } from "vitest";
import { HealthGraphError, projectHealthFacts } from "../src/index.js";
import { ReadNode } from "../src/read.js";
import { batch, claim, H, other, owner } from "./helpers.js";

// A lowered fact cap exercises the exact boundary without building 20,000 facts.
vi.mock("../src/limits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/limits.js")>()),
  MAX_PROJECTED_FACTS: 5,
}));

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
async function withSubjects(count: number, envelopes = 1) {
  const value = await batch(Array.from({ length: envelopes }, (_, i) => claim(`only-${i}`)));
  const assertionId = (value.nanopubs[0] as { assertionId: string }).assertionId;
  for (let i = 1; i < count; i++)
    value.dataset.addQuad(
      df.namedNode(`https://example.org/entities/extra-${i}`),
      df.namedNode(RDF_TYPE),
      df.namedNode(`${H}Condition`),
      df.namedNode(assertionId),
    );
  return value;
}

describe("projected fact cap (lowered to 5 for this file)", () => {
  it("projects exactly the maximum and refuses one more, with the fixed error", async () => {
    expect(projectHealthFacts(await withSubjects(5), { owner }).facts).toHaveLength(5);
    let thrown: unknown;
    try {
      projectHealthFacts(await withSubjects(6), { owner });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HealthGraphError);
    expect(thrown).toMatchObject({
      code: "too-large",
      message: new HealthGraphError("too-large").message,
    });
  });

  it("works out a shared assertion once, however many envelopes state it", async () => {
    // Subjects linked to another person yield no fact, so the fact cap never counts
    // them; the per-assertion plan keeps their cost independent of the envelope count.
    const build = async (envelopes: number, foreign: number) => {
      const value = await withSubjects(1, envelopes);
      const assertionId = (value.nanopubs[0] as { assertionId: string }).assertionId;
      for (let i = 0; i < foreign; i++) {
        const subject = df.namedNode(`https://example.org/entities/foreign-${i}`);
        for (const [p, o] of [
          [RDF_TYPE, `${H}Condition`],
          [`${H}patient`, other],
        ] as const)
          value.dataset.addQuad(
            subject,
            df.namedNode(p),
            df.namedNode(o),
            df.namedNode(assertionId),
          );
      }
      return value;
    };
    const calls = async (envelopes: number, foreign: number) => {
      const value = await build(envelopes, foreign);
      const spy = vi.spyOn(ReadNode.prototype, "terms");
      const view = projectHealthFacts(value, { owner });
      const count = spy.mock.calls.length;
      spy.mockRestore();
      expect(view.facts).toHaveLength(envelopes);
      expect(view.excludedOtherSubjects).toBe(foreign ? envelopes : 0);
      return count;
    };
    // The cost of two more envelopes is the same with 40 foreign subjects as with none.
    const withForeign = (await calls(4, 40)) - (await calls(2, 40));
    const without = (await calls(4, 0)) - (await calls(2, 0));
    expect(withForeign).toBe(without);
  });
});
