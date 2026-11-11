// AUTHORED-BY Codex GPT-6.1-Sol
import { serialize } from "@jeswr/rdf-serialize";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory as df, Store } from "n3";
import { expect, it } from "vitest";
import {
  buildNanopublications,
  createFactAssertion,
  createNanopubProvenanceReader,
  parseNanopublications,
  pkgId,
  readNanopubProvenance,
  serializeNanopublications,
} from "../src/index.js";
import { NS, RdfNode } from "../src/rdf.js";

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
