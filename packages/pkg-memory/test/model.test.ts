// AUTHORED-BY Codex GPT-6.1-Sol
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee the referenced entries. */
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import { isomorphic } from "rdf-isomorphic";
import { describe, expect, it } from "vitest";
import {
  type Batch,
  buildNanopublications,
  canonicalizeAssertion,
  createFactAssertion,
  type Fact,
  parseAssertion,
  parseNanopublications,
  serializeNanopublications,
} from "../src/index.js";
import { exampleBuildOptions } from "../src/testing.js";

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const options = exampleBuildOptions();
const owner = options.owner;
function batch(
  assertion = '<https://example.org/people/avery#me> <https://schema.org/name> "Avery Example" .',
): Batch {
  return {
    batch_id: "test",
    worker: { agent_id: "https://example.org/agents/test", agent_label: "Test agent" },
    claims: [{ id: "one", assertion, epistemic: "SelfReportedExplicit" }],
  };
}

it("matches all Python fixture ids byte-for-byte and the complete dataset isomorphically", async () => {
  const input: Batch = JSON.parse(await fixture("synthetic.claims.json"));
  const result = await buildNanopublications(input, options);
  expect(
    result.nanopubs.map(({ id, assertionId, provenanceId, pubinfoId }) => ({
      id,
      assertionId,
      provenanceId,
      pubinfoId,
    })),
  ).toEqual(JSON.parse(await fixture("synthetic.ids.json")));
  const expected = await parseRdf(await fixture("synthetic.expected.trig"), "application/trig");
  expect(isomorphic([...result.dataset], [...expected])).toBe(true);
  const parsed = await parseNanopublications(await serializeNanopublications(result));
  expect(parsed.nanopubs).toEqual(result.nanopubs);
  expect(isomorphic([...result.dataset], [...parsed.dataset])).toBe(true);
  expect(parsed.dataset.size).toBe(223);
});

const examples: Fact[] = [
  {
    template: "address",
    value: {
      id: "https://example.org/entities/residence",
      locality: "Storyville",
      country: "Exampleland",
      street: "12 Fiction Lane",
      postalCode: "EX1 2AB",
      home: true,
      validFrom: { value: "2025-02", datatype: "gYearMonth" },
      validThrough: { value: "2026", datatype: "gYear" },
    },
  },
  { template: "email", value: "avery@example.org" },
  { template: "phone", value: "+1-202-555-0100" },
  { template: "preference", value: { propertyID: "beverage", value: "Mint tea" } },
  {
    template: "condition",
    value: {
      id: "https://example.org/entities/condition",
      name: "Fictional condition",
      code: {
        id: "https://example.org/entities/code",
        value: "EX-C",
        exactMatch: "https://example.org/concepts/fictional-condition",
      },
    },
  },
  {
    template: "allergy",
    value: { id: "https://example.org/entities/allergy", name: "Fictional intolerance" },
  },
  {
    template: "medication",
    value: {
      id: "https://example.org/entities/statement",
      medication: {
        id: "https://example.org/entities/product",
        name: "Fictionalium",
        atcCode: "EX00",
      },
      dose: { value: "2.00", unit: "mg", frequency: "daily" },
    },
  },
  {
    template: "relationship",
    value: {
      id: "https://example.org/entities/role",
      roleName: "friend",
      person: "https://example.org/people/morgan#me",
      startDate: { value: "2024-01-01", datatype: "date" },
    },
  },
];

describe.each(examples)("$template template", (fact) => {
  it("round-trips assertion and provenance through TriG", async () => {
    const input = batch();
    input.claims[0]!.assertion = createFactAssertion(owner, fact);
    input.claims[0]!.evidence = [{ source: "document", quote: "Synthetic evidence." }];
    input.claims[0]!.categories = ["pd:Preference"];
    input.sources = [
      { id: "document", kind: "document", url: "https://example.org/documents/source" },
    ];
    const result = await buildNanopublications(input, options);
    const roundTrip = await parseNanopublications(
      await serializeNanopublications(result),
      "https://example.org/nanopub.trig",
    );
    expect(roundTrip.nanopubs).toEqual(result.nanopubs);
    expect(isomorphic([...result.dataset], [...roundTrip.dataset])).toBe(true);
    expect(roundTrip.nanopubs[0]!.evidence[0]!.quote).toBe("Synthetic evidence.");
  });
});

it("templates reproduce the five independent Python assertions", async () => {
  const input: Batch = JSON.parse(await fixture("synthetic.claims.json"));
  for (const fact of examples.filter((f) =>
    ["address", "preference", "condition", "medication", "relationship"].includes(f.template),
  )) {
    const claim = input.claims.find((c) => c.id === fact.template)!;
    const fromPythonInput = canonicalizeAssertion(
      await parseAssertion(claim.assertion as string, owner),
    );
    const fromTemplate = canonicalizeAssertion(createFactAssertion(owner, fact));
    expect(fromTemplate.id).toBe(fromPythonInput.id);
    expect(isomorphic([...fromTemplate.dataset], [...fromPythonInput.dataset])).toBe(true);
  }
});

it("shares assertion graphs while keeping each claim's epistemic metadata isolated", async () => {
  const input = batch();
  input.claims.push({
    ...input.claims[0]!,
    id: "two",
    epistemic: "Documented",
    validity: "Historical",
    attributed_to: "https://example.org/institution",
  });
  const built = await buildNanopublications(input, options);
  expect(built.nanopubs).toHaveLength(2);
  expect(new Set(built.nanopubs.map((n) => n.assertionId)).size).toBe(1);
  expect(new Set(built.nanopubs.map((n) => n.epistemic))).toEqual(
    new Set(["SelfReportedExplicit", "Documented"]),
  );
  const another = await buildNanopublications({ ...input, batch_id: "another" }, options);
  expect(another.nanopubs[0]!.assertionId).toBe(built.nanopubs[0]!.assertionId);
  expect(another.nanopubs[0]!.id).not.toBe(built.nanopubs[0]!.id);
});

it("records optional source, entity and evidence metadata without filesystem or network access", async () => {
  const input = batch();
  input.worker.started = "2026-10-25T12:00:00.000000Z";
  input.worker.finished = "2026-10-25T12:00:01.125Z";
  input.sources = [
    {
      id: "chat",
      kind: "claude-session",
      thread_id: "12345678-1234-4234-8234-123456789abc",
      cwd: "/synthetic",
      model: "example-model",
      originator: "test",
      rollout_path: "/synthetic/does-not-exist.jsonl",
    },
    {
      id: "email",
      kind: "email",
      path: "/synthetic/does-not-exist.eml",
      derived_from: ["https://example.org/primary"],
    },
    { id: "document", kind: "document", url: "https://example.org/document" },
  ];
  input.entities = [
    {
      id: "https://example.org/people/avery#me",
      label: "Avery Example",
      types: ["schema:Person"],
      aliases: ["Avery"],
      same_as: ["https://example.org/identity/avery"],
      url: "https://example.org/avery",
      note: "Synthetic entity",
    },
    { id: "https://example.org/entities/unnamed-type", label: "Synthetic object" },
  ];
  input.claims[0]!.evidence = [
    { source: "chat", message_id: "m-one", timestamp: "2026-10-24T10:00:00Z" },
    { source: "chat", message_id: "m-two", speaker: "Fictional narrator" },
    { source: "email", locator: "line=2", timestamp: "2026-10-23T10:00:00Z" },
    { source: "document" },
  ];
  input.claims[0]!.epistemic = "Inferred";
  input.claims[0]!.inference = { rule: "pkg-rule:synthetic" };
  input.claims[0]!.supersedes = ["one"];
  input.skipped_sensitive = [
    { category: "pd:Identifying" },
    { category: "pd:Identifying", source: "missing" },
  ];
  const result = await buildNanopublications(input, options);
  expect(result.nanopubs[0]!.evidence).toHaveLength(4);
  expect(result.nanopubs[0]!.attributedTo).toEqual([]);
  expect(
    [...result.dataset].some((q) => q.object.value === "file:///synthetic/does-not-exist.eml"),
  ).toBe(true);
  expect([...result.dataset].some((q) => q.object.value === "2026-10-23T10:00:00+00:00")).toBe(
    true,
  );
  const noTimes = batch();
  noTimes.claims[0]!.supersedes = ["one"];
  await expect(buildNanopublications(noTimes, { owner })).resolves.toBeDefined();
});

it("supports bare and already-qualified contact values and minimal/temporal template variants", async () => {
  const facts: Fact[] = [
    { template: "phone", value: "tel:+1-202-555-0100" },
    { template: "email", value: "mailto:avery@example.org" },
    {
      template: "address",
      value: { id: "https://example.org/a", locality: "Storyville", country: "Exampleland" },
    },
    { template: "condition", value: { id: "https://example.org/c", name: "Fictional condition" } },
    {
      template: "condition",
      value: {
        id: "https://example.org/c",
        name: "Fictional condition",
        code: { id: "https://example.org/code", value: "EX-C" },
      },
    },
    {
      template: "medication",
      value: {
        id: "https://example.org/s",
        medication: { id: "https://example.org/m", name: "Fictionalium" },
      },
    },
    {
      template: "medication",
      value: {
        id: "https://example.org/s",
        medication: { id: "https://example.org/m", name: "Fictionalium" },
        dose: { value: "2", unit: "mg" },
      },
    },
    {
      template: "relationship",
      value: {
        id: "https://example.org/r",
        person: owner,
        roleName: "friend",
        endDate: { value: "2026-10-25T12:00:00Z", datatype: "dateTime" },
      },
    },
  ];
  for (const fact of facts) {
    const input = batch();
    input.claims[0]!.assertion = createFactAssertion(owner, fact);
    expect((await buildNanopublications(input, options)).nanopubs).toHaveLength(1);
  }
});

it("expands the owner shorthand without embedding a personal default", async () => {
  const input = batch();
  input.claims[0]!.attributed_to = "me";
  expect((await buildNanopublications(input, options)).nanopubs[0]!.attributedTo).toEqual([owner]);
});
