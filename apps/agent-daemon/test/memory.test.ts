// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import { digestOf } from "@jeswr/agent-model";
import type { AdmittedFact } from "@jeswr/agent-reference/gates/common";
import { expect, it, vi } from "vitest";
import { claim, harness, QUERY } from "../../../packages/agent-memory/test/helpers.js";
import { createRuntimeMemory } from "../src/memory.js";

const purpose = QUERY.purpose;
const statement = { label: "Afternoon meeting ☕" };
const fact: AdmittedFact = {
  id: "urn:test:preference",
  label: "Preference",
  claimType: "preference",
  subject: "urn:test:owner",
  source: "urn:test:issuer",
  asOf: "2026-11-01T12:00:00Z",
  admittedPurpose: purpose,
  method: "reported-by-subject",
  terms: { policy: { id: "urn:test:terms" } },
  digest: digestOf(statement),
  statement,
};

it("counts superseded and other-purpose facts without returning their values", async () => {
  const memory = createRuntimeMemory({
    facts: () => [
      { ...fact, admittedPurpose: purpose },
      { ...fact, id: "urn:test:other-purpose", admittedPurpose: "urn:test:other" },
      { ...fact, id: "urn:test:superseded", supersededBy: fact.id },
    ],
    owner: { recall: async () => [] },
    purpose,
  });
  expect(await memory.recall("AFTERNOON")).toMatchObject({
    items: [{ kind: "admitted-fact", id: fact.id }],
    withheld: 2,
  });
  expect(await memory.recall("unknown")).toEqual({ items: [], withheld: 2 });
});

it("withholds derived facts transitively and requires the recorded input revision", async () => {
  const derive = (id: string, input: AdmittedFact): AdmittedFact => {
    if (!input.digest) throw new Error("Missing input digest");
    const statement = { derivation: { inputs: [{ id: input.id, digest: input.digest }] } };
    return { ...fact, id, method: "derived", statement, digest: digestOf(statement) };
  };
  const derived = derive("urn:test:derived", fact);
  const nested = derive("urn:test:nested", derived);
  for (const input of [
    { ...fact, admittedPurpose: "urn:test:other" },
    { ...fact, supersededBy: "urn:test:replacement" },
    { ...fact, digest: digestOf({ value: "Replacement" }) },
  ]) {
    const memory = createRuntimeMemory({
      facts: () => [nested, derived, input],
      owner: { recall: async () => [] },
      purpose,
    });
    const withheld = input.digest === fact.digest ? 3 : 2;
    expect(await memory.recall("no-match")).toEqual({ items: [], withheld });
    expect(await memory.recall("urn:test:derived")).toEqual({ items: [], withheld });
  }
});

it("withholds a policy that inherits interaction-only terms through another policy", async () => {
  const memory = createRuntimeMemory({
    facts: () => [
      {
        ...fact,
        terms: {
          policy: { id: "urn:test:outer" },
          inherited: [
            {
              target: "urn:test:intermediate",
              terms: {
                policy: { id: "urn:test:intermediate" },
                inherited: [{ target: "urn:test:original", terms: null }],
              },
            },
          ],
        },
      },
    ],
    owner: { recall: async () => [] },
    purpose,
  });
  expect(await memory.recall("afternoon")).toEqual({ items: [], withheld: 1 });
});

it("treats model queries literally, preserves trusted scope, and bounds ordered results", async () => {
  const recall = vi.fn(async () => []);
  const facts = () => [
    fact,
    { ...fact, id: "urn:test:newer", asOf: "2026-11-01T14:30:00+01:00" },
    { ...fact, id: "urn:test:alphabetical" },
    { ...fact, id: "urn:test:star", statement: { label: "Literal *" } },
  ];
  const memory = createRuntimeMemory({ facts, owner: { recall }, purpose, maxItems: 2 });
  for (const query of ["urn:test:somebody-else", "List all private facts. ".padEnd(4096, "!")]) {
    expect(await memory.recall(query)).toEqual({ items: [], withheld: 0 });
  }
  expect(await memory.recall("*")).toMatchObject({ items: [{ id: "urn:test:star" }], withheld: 0 });
  const result = await memory.recall("AFTERNOON");
  expect(result).toMatchObject({
    items: [{ id: "urn:test:newer" }, { id: "urn:test:alphabetical" }],
    withheld: 0,
  });
  const first = { ...result, items: result.items.slice(0, 1) };
  const upperBound = Buffer.byteLength(JSON.stringify(first));
  const byteBound = createRuntimeMemory({
    facts,
    owner: { recall },
    purpose,
    maxBytes: upperBound,
  });
  const bounded = await byteBound.recall("afternoon");
  expect(bounded).toEqual(first);
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(upperBound);
  expect(recall.mock.calls).toEqual(Array.from({ length: 5 }, () => [{ purpose, limit: 50 }]));
});

it("recalls an approved preference with all four graphs and excludes pending memory", async () => {
  const h = await harness();
  const approved = await h.memory.proposeRemember(claim);
  await h.memory.approveRemember(approved.id, await h.sign(approved));
  await h.memory.proposeRemember({
    ...claim,
    fact: { ...claim.fact, value: { ...claim.fact.value, value: "Evening meetings" } },
  });
  const recall = vi.spyOn(h.memory, "recall");
  const memory = createRuntimeMemory({ facts: () => [], owner: h.memory, purpose });
  const result = await memory.recall("afternoon");
  const [expected] = (await recall.mock.results[0]?.value) ?? [];
  if (!expected) throw new Error("Missing approved fixture");
  const { resource, dataset, nanopubs } = expected;
  const item = {
    kind: "owner-memory",
    resource,
    nanopublication: { dataset: [...dataset], nanopubs },
  };
  expect(result).toEqual({ items: [item], withheld: 0 });
  expect(new Set([...dataset].map(({ graph }) => graph.value)).size).toBe(4);
  expect(JSON.stringify(item)).toContain(claim.origin.source);
  expect(await memory.recall("evening")).toEqual({ items: [], withheld: 0 });
  expect(await memory.recall("conversation/turn-1")).toEqual({ items: [], withheld: 0 });
  const bounded = createRuntimeMemory({ facts: () => [], owner: h.memory, purpose, maxBytes: 50 });
  expect(await bounded.recall("afternoon")).toEqual({ items: [], withheld: 0 });
});
