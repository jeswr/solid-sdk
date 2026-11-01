// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  buildNanopublications,
  canonicalizeAssertion,
  createFactAssertion,
  parseAssertion,
  parseNanopublications,
  serializeNanopublications,
} from "../src/index.js";
import { NS } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const LEGACY = "https://w3id.org/jeswr/sectors/health#";
const options = exampleBuildOptions();

describe("memory namespace migration", () => {
  it("authors canonical health/core template terms and writes them without legacy aliases", async () => {
    const assertion = createFactAssertion(options.owner, {
      template: "condition",
      value: {
        id: "https://example.org/condition",
        name: "Fictional condition",
        code: { id: "https://example.org/code", value: "EX-C" },
      },
    });
    expect([...assertion].some((q) => q.predicate.value === `${NS.core}value`)).toBe(true);
    expect([...assertion].some((q) => q.object.value === `${NS.health}Condition`)).toBe(true);
    const built = await buildNanopublications(
      {
        batch_id: "canonical",
        worker: {
          agent_id: "https://example.org/agent",
          agent_label: "Synthetic agent",
        },
        claims: [{ id: "one", assertion, epistemic: "Documented" }],
      },
      options,
    );
    const trig = await serializeNanopublications(built);
    expect(trig).not.toContain("https://w3id.org/jeswr/");
    expect((await parseNanopublications(trig)).nanopubs).toEqual(built.nanopubs);
  });

  it.each([
    LEGACY,
    NS.health,
  ])("preserves %s assertion hash inputs and mixed data on round-trip", async (ns) => {
    const assertion = await parseAssertion(
      `
      <https://example.org/condition> a <${ns}Condition> ;
        <${LEGACY}patient> <${options.owner}> ; <${NS.health}patient> <${options.owner}> .
    `,
      options.owner,
    );
    const hash = canonicalizeAssertion(assertion).id;
    const built = await buildNanopublications(
      {
        batch_id: "preserve",
        worker: {
          agent_id: "https://example.org/agent",
          agent_label: "Synthetic agent",
        },
        claims: [{ id: "one", assertion, epistemic: "Documented" }],
      },
      options,
    );
    const parsed = await parseNanopublications(await serializeNanopublications(built));
    expect(parsed.nanopubs[0]?.assertionId).toBe(hash);
    expect([...parsed.dataset].some((q) => q.predicate.value === `${LEGACY}patient`)).toBe(true);
    expect([...parsed.dataset].some((q) => q.predicate.value === `${NS.health}patient`)).toBe(true);
  });

  it("keeps the reference parser's implicit legacy prefixes as hash inputs", async () => {
    const assertion = await parseAssertion(
      '<https://example.org/code> a health:CodeableConcept ; core:value "EX-C" .',
      options.owner,
    );
    expect(
      [...assertion].some((q) => q.predicate.value === "https://w3id.org/jeswr/core#value"),
    ).toBe(true);
    const canonical = await parseAssertion(
      `@prefix health: <${NS.health}> . @prefix core: <${NS.core}> .
      <https://example.org/code> a health:CodeableConcept ; core:value "EX-C" .`,
      options.owner,
    );
    expect(canonicalizeAssertion(assertion).id).not.toBe(canonicalizeAssertion(canonical).id);
  });
});
