// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { serialize } from "@jeswr/rdf-serialize";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory as df, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { expect, expectTypeOf, it } from "vitest";
import {
  buildNanopublications,
  classifyNanopublications,
  createFactAssertion,
  createNanopubProvenanceReader,
  parseNanopublications,
  parseNanopublicationsTolerant,
  pkgId,
  readNanopubProvenance,
  serializeNanopublications,
  type TolerantNanopublications,
} from "../src/index.js";
import { graph, NS, putGraph, RdfNode } from "../src/rdf.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fictional fixture");
  return value;
}

const owner = "https://example.org/people/avery#me";
async function fixture(batch = "tolerance") {
  return buildNanopublications(
    {
      batch_id: batch,
      worker: {
        agent_id: "https://example.org/agent",
        agent_label: "Fictional extractor",
      },
      sources: [
        {
          id: "doc",
          kind: "document",
          url: "https://example.org/document",
          title: "Fictional source",
        },
      ],
      entities: [{ id: "https://example.org/entity", label: "Fictional entity" }],
      claims: ["a", "b", "c"].map((id) => ({
        id,
        assertion: createFactAssertion(owner, {
          template: "condition",
          value: {
            id: `https://example.org/${id}`,
            name: `Fictional ${id}`,
          },
        }),
        epistemic: "SelfReportedExplicit",
        evidence: [{ source: "doc", quote: `Fictional ${id}` }],
      })),
    },
    { owner, generatedAt: "2026-11-01T00:00:00Z" },
  );
}
const raw = (dataset: Store) => serialize([...dataset], { format: "application/trig" });
it("preserves term-safety error precedence when a graph also has an invalid literal", async () => {
  const value = await fixture();
  const bad = required(value.nanopubs[0]);
  const contents = new NamedGraphDataset(df.namedNode(bad.assertionId), value.dataset, df);
  const node = new RdfNode("https://example.org/extra", contents);
  node
    .terms(`${NS.schema}value`)
    .add(df.literal("42", df.namedNode("https://example.org/datatype")));
  node.terms(`${NS.schema}url`).add(df.namedNode("ftp://example.org/unsupported"));
  const result = await parseNanopublications(await raw(value.dataset), { invalid: "skip" });
  expect(result.skipped).toEqual([{ id: bad.id, errorClass: "Error" }]);
});
it.each([
  "id",
  "assertionId",
  "provenanceId",
  "pubinfoId",
] as const)("skips an entire envelope for an invalid %s graph", async (field) => {
  const value = await fixture();
  const bad = required(value.nanopubs[0]);
  value.dataset.addQuad(
    df.namedNode("https://example.org/extra"),
    df.namedNode(`${NS.schema}name`),
    df.literal("Fictional\u2028value"),
    df.namedNode(bad[field]),
  );
  const trig = await raw(value.dataset);
  await expect(parseNanopublications(trig)).rejects.toMatchObject({
    name: "UnsupportedLiteralCharacterError",
  });
  const result = await parseNanopublications(trig, { invalid: "skip" });
  expect(result.nanopubs).toEqual(value.nanopubs.slice(1));
  expect(result.skipped).toEqual([{ id: bad.id, errorClass: "UnsupportedLiteralCharacterError" }]);
  const kept = new Set(
    result.nanopubs.flatMap((np) => [np.id, np.assertionId, np.provenanceId, np.pubinfoId]),
  );
  for (const name of [bad.id, bad.assertionId, bad.provenanceId, bad.pubinfoId])
    if (!kept.has(name))
      expect(result.dataset.match(null, null, null, df.namedNode(name)).size).toBe(0);
  expect(JSON.stringify(result.skipped)).not.toContain("Fictional");
  expect(await parseNanopublications(await serializeNanopublications(result))).toMatchObject({
    nanopubs: result.nanopubs,
  });
});
it.each([
  [df.literal("Fictional\u000cvalue"), "UnsupportedLiteralCharacterError"],
  [
    df.literal("42", df.namedNode("https://example.org/datatype")),
    "UnsupportedLiteralDatatypeError",
  ],
  [df.literal("01", df.namedNode(`${NS.xsd}integer`)), "UnsupportedLiteralLexicalFormError"],
  [df.namedNode("ftp://example.org/unsupported"), "Error"],
] as const)("reports only the error class for invalid terms (%s)", async (object, errorClass) => {
  const value = await fixture();
  value.dataset.addQuad(
    df.namedNode("https://example.org/extra"),
    df.namedNode(`${NS.schema}value`),
    object,
    df.namedNode(required(value.nanopubs[0]).assertionId),
  );
  const result = await parseNanopublications(await raw(value.dataset), {
    invalid: "skip",
    baseIRI: "https://example.org/export",
  });
  expect(result.skipped).toEqual([{ id: required(value.nanopubs[0]).id, errorClass }]);
  expect(result.nanopubs).toHaveLength(2);
});
it("skips every envelope sharing an invalid assertion; keeps a shared assertion if only one provenance fails", async () => {
  const value = await fixture();
  const a = required(value.nanopubs[0]);
  const b = required(value.nanopubs[1]);
  const link = required(value.dataset.getQuads(b.id, `${NS.np}hasAssertion`, null, b.id)[0]);
  value.dataset.removeQuad(link);
  value.dataset.addQuad(link.subject, link.predicate, df.namedNode(a.assertionId), link.graph);
  // Replace only the assertion references in B's provenance, keeping annotations coherent.
  const original = value.dataset.getQuads(null, null, null, b.provenanceId);
  for (const q of original) {
    value.dataset.removeQuad(q);
    value.dataset.addQuad(
      q.subject.equals(df.namedNode(b.assertionId)) ? df.namedNode(a.assertionId) : q.subject,
      q.predicate,
      q.object.equals(df.namedNode(b.assertionId)) ? df.namedNode(a.assertionId) : q.object,
      q.graph,
    );
  }
  const poison = df.quad(
    df.namedNode("https://example.org/extra"),
    df.namedNode(`${NS.schema}value`),
    df.literal("Fictional\u2028value"),
    df.namedNode(b.provenanceId),
  );
  value.dataset.addQuad(poison);
  const partial = await parseNanopublications(await raw(value.dataset), { invalid: "skip" });
  expect(partial.nanopubs).toHaveLength(2);
  expect(partial.dataset.match(null, null, null, df.namedNode(a.assertionId)).size).toBeGreaterThan(
    0,
  );
  value.dataset.removeQuad(poison);
  value.dataset.addQuad(
    poison.subject,
    poison.predicate,
    poison.object,
    df.namedNode(a.assertionId),
  );
  const result = await parseNanopublications(await raw(value.dataset), { invalid: "skip" });
  expect(result.nanopubs).toHaveLength(1);
  expect(result.skipped).toHaveLength(2);
});
it.each([
  "sources",
  "entities",
])("skips users of an invalid batch %s graph and removes orphan batch graphs", async (kind) => {
  const bad = await fixture("bad");
  const good = await fixture("good");
  // Distinct assertions avoid intentional sharing between the two batches.
  bad.dataset.addQuad(
    df.namedNode("https://example.org/extra"),
    df.namedNode(`${NS.schema}value`),
    df.literal("Fictional\u000cvalue"),
    df.namedNode(pkgId("batch", "bad", kind)),
  );
  const result = await parseNanopublications(
    await raw(new Store([...bad.dataset, ...good.dataset])),
    { invalid: "skip" },
  );
  expect(result.nanopubs).toEqual(good.nanopubs);
  expect(result.skipped).toHaveLength(3);
  for (const graph of ["sources", "entities"])
    expect(
      result.dataset.match(null, null, null, df.namedNode(pkgId("batch", "bad", graph))).size,
    ).toBe(0);
  const allSkipped = await parseNanopublications(await raw(bad.dataset), { invalid: "skip" });
  expect(allSkipped.nanopubs).toEqual([]);
  expect(allSkipped.dataset.size).toBe(0);
});
it("preserves the atomic default/baseIRI overload and refuses syntax, missing heads, and malformed metadata", async () => {
  const value = await fixture();
  const trig = await serializeNanopublications(value);
  expect(await parseNanopublications(trig, "https://example.org/export")).toMatchObject({
    nanopubs: value.nanopubs,
  });
  expect((await parseNanopublications(trig, { invalid: "skip" })).skipped).toEqual([]);
  await expect(parseNanopublications("invalid RDF", { invalid: "skip" })).rejects.toThrow();
  await expect(parseNanopublications("", { invalid: "skip" })).rejects.toThrow(
    "No nanopublications",
  );
  const np = required(value.nanopubs[0]);
  value.dataset.removeQuads(
    value.dataset.getQuads(np.assertionId, `${NS.pkg}epistemicStatus`, null, np.provenanceId),
  );
  await expect(
    parseNanopublications(await raw(value.dataset), { invalid: "skip" }),
  ).rejects.toThrow();
});
it("the provenance reader caches batch graphs per invocation and remains fresh on later projections", async () => {
  const value = await fixture();
  const read = createNanopubProvenanceReader(value);
  for (const np of value.nanopubs) expect(read(np)).toEqual(readNanopubProvenance(value, np));
  const other = await fixture("other");
  value.dataset.addQuads([...other.dataset]);
  expect(read(required(other.nanopubs[0]))).toEqual(
    readNanopubProvenance(value, required(other.nanopubs[0])),
  );
  value.dataset.removeQuads(
    value.dataset.getQuads(null, `${NS.schema}name`, null, pkgId("batch", "tolerance", "sources")),
  );
  expect(
    createNanopubProvenanceReader(value)(required(value.nanopubs[0])).sources[0]?.title,
  ).toBeUndefined();
});

it("exposes an explicit tolerant entry point with an unambiguous return type", async () => {
  expectTypeOf<
    Awaited<ReturnType<typeof parseNanopublicationsTolerant>>
  >().toEqualTypeOf<TolerantNanopublications>();
  const value = await fixture();
  const trig = await serializeNanopublications(value);
  const result = await parseNanopublicationsTolerant(trig);
  expect(result.nanopubs).toEqual(value.nanopubs);
  expect(result.skipped).toEqual([]);
  expect(result.affected).toEqual([]);
  for (const equivalent of [
    await parseNanopublicationsTolerant(trig, { baseIRI: "https://example.org/export" }),
    await parseNanopublications(trig, { invalid: "skip" }),
  ]) {
    expect(equivalent).toMatchObject({ nanopubs: result.nanopubs, skipped: [], affected: [] });
    expect(isomorphic([...equivalent.dataset], [...result.dataset])).toBe(true);
  }
});

it.each([
  "id",
  "provenanceId",
  "pubinfoId",
] as const)("collects only IRI revision/contradiction targets from a skipped %s graph", async (field) => {
  for (const predicate of [`${NS.prov}wasRevisionOf`, `${NS.pkg}contradicts`]) {
    for (const target of ["id", "assertionId"] as const) {
      const value = await fixture();
      const [a, b, c] = value.nanopubs.map(required);
      const original = required(a),
        bad = required(b),
        unrelated = required(c);
      const metadata = graph(value.dataset, bad[field]);
      new RdfNode(bad.id, metadata)
        .link(predicate, original[target])
        .text(predicate, unrelated.id)
        .text(predicate, unrelated.assertionId)
        .add(predicate, df.blankNode());
      // Duplicate the target: affected contains retained IDs only, once each.
      new RdfNode("https://example.org/extra", metadata)
        .link(predicate, original[target])
        .link(predicate, "https://example.org/missing");
      putGraph(value.dataset, bad[field], metadata);
      value.dataset.addQuad(
        df.namedNode("https://example.org/extra"),
        df.namedNode(`${NS.schema}name`),
        df.literal("Fictional\u2028value"),
        df.namedNode(bad[field]),
      );
      const result = await parseNanopublicationsTolerant(await raw(value.dataset));
      expect(result.affected).toEqual([original.id]);
      expect(classifyNanopublications(result).find((np) => np.id === original.id)).toMatchObject({
        belief: "might",
        affectedBySkipped: true,
      });
      expect(classifyNanopublications(result).find((np) => np.id === unrelated.id)).toMatchObject({
        belief: "definitely",
      });
      expect(JSON.stringify(result.affected)).not.toContain("Fictional");
    }
  }
});

it("reads update IRIs even when an assertion or batch failure skips the envelope", async () => {
  for (const field of ["assertionId", "batch"] as const) {
    const value = await fixture();
    const other = await fixture("other");
    value.dataset.addQuads([...other.dataset]);
    const bad = required(value.nanopubs[0]);
    const target = required(other.nanopubs[1]);
    const metadata = graph(value.dataset, bad.provenanceId);
    new RdfNode(bad.id, metadata).link(`${NS.prov}wasRevisionOf`, target.id);
    putGraph(value.dataset, bad.provenanceId, metadata);
    const poisoned = field === "batch" ? pkgId("batch", bad.batch, "sources") : bad.assertionId;
    value.dataset.addQuad(
      df.namedNode("https://example.org/extra"),
      df.namedNode(`${NS.schema}value`),
      df.literal("Fictional\u2028value"),
      df.namedNode(poisoned),
    );
    const result = await parseNanopublicationsTolerant(await raw(value.dataset));
    expect(result.affected).toEqual([target.id]);
  }
});

it("ignores update-like assertion data and non-IRI head graph links on a skipped envelope", async () => {
  const value = await fixture();
  const a = required(value.nanopubs[0]),
    b = required(value.nanopubs[1]);
  const assertion = graph(value.dataset, b.assertionId);
  new RdfNode(b.id, assertion).link(`${NS.prov}wasRevisionOf`, a.id);
  putGraph(value.dataset, b.assertionId, assertion);
  const head = graph(value.dataset, b.id);
  new RdfNode(b.id, head)
    .text(`${NS.np}hasProvenance`, "Fictional literal graph")
    .add(`${NS.np}hasPublicationInfo`, df.blankNode());
  putGraph(value.dataset, b.id, head);
  value.dataset.addQuad(
    df.namedNode("https://example.org/extra"),
    df.namedNode(`${NS.schema}name`),
    df.literal("Fictional\u2028value"),
    df.namedNode(b.id),
  );
  const result = await parseNanopublicationsTolerant(await raw(value.dataset));
  expect(result.skipped).toEqual([{ id: b.id, errorClass: "UnsupportedLiteralCharacterError" }]);
  expect(result.affected).toEqual([]);
});

it("collects update targets even when the skipped head IRI itself fails validation", async () => {
  const value = await fixture();
  const a = required(value.nanopubs[0]),
    b = required(value.nanopubs[1]);
  const provenance = graph(value.dataset, b.provenanceId);
  new RdfNode(b.id, provenance).link(`${NS.prov}wasRevisionOf`, a.id);
  putGraph(value.dataset, b.provenanceId, provenance);
  const invalidId = "ftp://example.org/skipped";
  const rename = (term: import("@rdfjs/types").Term) =>
    term.termType === "NamedNode" && term.value === b.id ? df.namedNode(invalidId) : term;
  const dataset = new Store(
    [...value.dataset].map((q) =>
      df.quad(
        rename(q.subject) as typeof q.subject,
        q.predicate,
        rename(q.object) as typeof q.object,
        rename(q.graph) as typeof q.graph,
      ),
    ),
  );
  const result = await parseNanopublicationsTolerant(await raw(dataset));
  expect(result.skipped).toEqual([{ id: invalidId, errorClass: "Error" }]);
  expect(result.affected).toEqual([a.id]);
  expect(result.nanopubs).toHaveLength(2);
  expect((await parseNanopublications(await serializeNanopublications(result))).nanopubs).toEqual(
    result.nanopubs,
  );
});

it.each([
  "sources",
  "entities",
])("retains and validates inherited correspondence %s graphs", async (kind) => {
  const value = await fixture();
  const inherited = await fixture("inherited");
  const np = required(value.nanopubs[0]);
  for (const name of ["sources", "entities"])
    putGraph(
      value.dataset,
      pkgId("batch", "inherited", name),
      graph(inherited.dataset, pkgId("batch", "inherited", name)),
    );
  const provenance = graph(value.dataset, np.provenanceId);
  new RdfNode(np.id, provenance)
    .text(`${NS.pkg}correspondenceBatch`, "inherited")
    .text(`${NS.pkg}correspondenceBatch`, np.batch);
  putGraph(value.dataset, np.provenanceId, provenance);
  const valid = await parseNanopublicationsTolerant(await raw(value.dataset));
  for (const name of ["sources", "entities"])
    expect(graph(valid.dataset, pkgId("batch", "inherited", name)).size).toBeGreaterThan(0);
  expect((await parseNanopublications(await serializeNanopublications(valid))).nanopubs).toEqual(
    valid.nanopubs,
  );
  value.dataset.addQuad(
    df.namedNode("https://example.org/extra"),
    df.namedNode(`${NS.schema}value`),
    df.literal("Fictional\u2028value"),
    df.namedNode(pkgId("batch", "inherited", kind)),
  );
  const invalid = await parseNanopublicationsTolerant(await raw(value.dataset));
  expect(invalid.skipped).toEqual([{ id: np.id, errorClass: "UnsupportedLiteralCharacterError" }]);
  for (const name of ["sources", "entities"])
    expect(graph(invalid.dataset, pkgId("batch", "inherited", name)).size).toBe(0);
});

it.each([
  df.namedNode("https://example.org/batch"),
  df.literal("42", df.namedNode(`${NS.xsd}integer`)),
])("refuses malformed correspondence metadata during tolerant parsing: %s", async (term) => {
  const value = await fixture();
  const np = required(value.nanopubs[0]);
  const provenance = graph(value.dataset, np.provenanceId);
  new RdfNode(np.id, provenance).add(`${NS.pkg}correspondenceBatch`, term);
  putGraph(value.dataset, np.provenanceId, provenance);
  await expect(parseNanopublicationsTolerant(await raw(value.dataset))).rejects.toThrow(
    "Expected a correspondence batch string",
  );
});

it.each([
  false,
  true,
])("drops shared skipped heads transitively and round-trips the retained envelopes (multiple paths: %s)", async (multiple) => {
  const value = await fixture();
  const a = required(value.nanopubs[0]),
    b = required(value.nanopubs[1]),
    c = required(value.nanopubs[2]);
  // B uses A's head as its assertion; C uses B's head. A fails independently.
  for (const [np, target] of [
    [b, a.id],
    [c, b.id],
  ] as const) {
    const head = graph(value.dataset, np.id);
    const node = new RdfNode(np.id, head);
    node.terms(`${NS.np}hasAssertion`).clear();
    node.link(`${NS.np}hasAssertion`, target);
    value.dataset.removeQuads(value.dataset.getQuads(null, null, null, np.id));
    putGraph(value.dataset, np.id, head);
    const provenance = new Store();
    for (const q of graph(value.dataset, np.provenanceId))
      new RdfNode(q.subject.value === np.assertionId ? target : q.subject, provenance).add(
        q.predicate.value,
        q.object.value === np.assertionId ? df.namedNode(target) : q.object,
      );
    value.dataset.removeQuads(value.dataset.getQuads(null, null, null, np.provenanceId));
    putGraph(value.dataset, np.provenanceId, provenance);
  }
  if (multiple) {
    // C refers to both skipped heads; it must be counted once even if both paths fire.
    const head = graph(value.dataset, c.id);
    const node = new RdfNode(c.id, head);
    node.terms(`${NS.np}hasPublicationInfo`).clear();
    node.link(`${NS.np}hasPublicationInfo`, a.id);
    value.dataset.removeQuads(value.dataset.getQuads(null, null, null, c.id));
    putGraph(value.dataset, c.id, head);
    putGraph(value.dataset, a.id, graph(value.dataset, c.pubinfoId));
  }
  value.dataset.addQuad(
    df.namedNode(a.id),
    df.namedNode(`${NS.schema}name`),
    df.literal("Fictional\u2028value"),
    df.namedNode(a.provenanceId),
  );
  const good = await fixture("good");
  value.dataset.addQuads([...good.dataset]);
  const result = await parseNanopublicationsTolerant(await raw(value.dataset));
  expect(result.nanopubs).toEqual(good.nanopubs);
  expect(result.skipped).toEqual(
    expect.arrayContaining([
      { id: a.id, errorClass: "UnsupportedLiteralCharacterError" },
      { id: b.id, errorClass: "SharedGraphWithSkipped" },
      { id: c.id, errorClass: "SharedGraphWithSkipped" },
    ]),
  );
  expect(result.skipped).toHaveLength(3);
  expect(result.affected).toEqual([]);
  for (const { id } of result.skipped) expect(graph(result.dataset, id).size).toBe(0);
  expect((await parseNanopublications(await serializeNanopublications(result))).nanopubs).toEqual(
    result.nanopubs,
  );
});

it("lets an unreadable update only lower a current belief and never touch a past one", async () => {
  const value = await buildNanopublications(
    {
      batch_id: "belief-floor",
      worker: { agent_id: "https://example.org/agent", agent_label: "Fictional extractor" },
      claims: (
        [
          ["definite", "SelfReportedExplicit", "Current"],
          ["uncertain", "Inferred", "Current"],
          ["mentioned", "Mentioned", "Current"],
          ["ended", "SelfReportedExplicit", "Superseded"],
        ] as const
      ).map(([id, epistemic, validity]) => ({
        id,
        assertion: createFactAssertion(owner, {
          template: "condition",
          value: { id: `https://example.org/${id}`, name: `Fictional ${id}` },
        }),
        epistemic,
        validity,
      })),
    },
    { owner, generatedAt: "2026-11-01T00:00:00Z" },
  );
  const base = classifyNanopublications(value);
  const affected = classifyNanopublications({
    ...value,
    affected: value.nanopubs.map((np) => np.id),
  });
  expect(base.map((np) => np.belief)).toEqual(["definitely", "might", "mentioned", "past"]);
  expect(affected.map((np) => [np.belief, np.affectedBySkipped])).toEqual([
    ["might", true],
    ["might", true],
    ["mentioned", true],
    ["past", undefined],
  ]);
});

it("keeps contradiction targets when a skipped nanopub also names a kept envelope", async () => {
  const value = await fixture();
  const [a, b, c] = [0, 1, 2].map((i) => required(value.nanopubs[i])) as [
    (typeof value.nanopubs)[number],
    (typeof value.nanopubs)[number],
    (typeof value.nanopubs)[number],
  ];
  const metadata = graph(value.dataset, c.provenanceId);
  new RdfNode(c.id, metadata).link(`${NS.prov}wasRevisionOf`, a.id);
  new RdfNode(c.assertionId, metadata).link(`${NS.pkg}contradicts`, b.assertionId);
  putGraph(value.dataset, c.provenanceId, metadata);
  value.dataset.addQuad(
    df.namedNode("https://example.org/extra"),
    df.namedNode(`${NS.schema}name`),
    df.literal("Fictional\u2028value"),
    df.namedNode(c.provenanceId),
  );
  const result = await parseNanopublicationsTolerant(await raw(value.dataset));
  expect([...result.affected].sort()).toEqual([a.id, b.id].sort());
});

// AUTHORED-BY Claude Opus 5.5
it("leaves no skipped term reachable from the returned store's internal indexes", async () => {
  const value = await fixture();
  const b = required(value.nanopubs[1]);
  value.dataset.addQuad(
    df.namedNode("https://example.org/skipped-only-subject"),
    df.namedNode(`${NS.schema}name`),
    df.literal("Fictional skipped-only-value"),
    df.namedNode(b.id),
  );
  const result = await parseNanopublicationsTolerant(await raw(value.dataset));
  expect(result.skipped.map((s) => s.id)).toEqual([b.id]);
  // Walk every own value, Map key and array entry, including N3's private term index.
  const seen = new Set<unknown>();
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      if (node.includes("skipped-only")) found.push(node);
      return;
    }
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (node instanceof Map) for (const entry of node) entry.forEach(walk);
    else if (node instanceof Set) for (const v of node) walk(v);
    else
      for (const key of Reflect.ownKeys(node)) {
        if (typeof key === "string") walk(key);
        walk((node as Record<PropertyKey, unknown>)[key]);
      }
  };
  walk(result);
  expect(found).toEqual([]);
});
