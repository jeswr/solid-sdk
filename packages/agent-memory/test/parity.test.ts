// AUTHORED-BY Codex GPT-6.1-Sol
import { type Batch, buildNanopublications, parseNanopublications, pkgId } from "@jeswr/pkg-memory";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports require bare package names
import { readFile } from "fs/promises";
import { Store } from "n3";
import { expect, it } from "vitest";

// Reuse the committed independent Python oracle; never regenerate expectations with the TS builder.
// Prefix batches exclude only later claims and the invalidation those later claims would add.
const fixture = (name: string) =>
  readFile(new URL(`../../pkg-memory/test/fixtures/${name}`, import.meta.url), "utf8");
it.each([
  3, 4, 5,
])("matches Python IDs and canonical dataset bytes for a %i-claim fixture batch", async (count) => {
  const batch: Batch = JSON.parse(await fixture("synthetic.claims.json"));
  batch.claims = batch.claims.slice(0, count);
  const actual = await buildNanopublications(batch, {
    owner: "https://example.org/people/avery#me",
    generatedAt: "2026-10-25T12:00:00+00:00",
  });
  const reference = await parseNanopublications(await fixture("synthetic.expected.trig"));
  const claims = new Set(batch.claims.map((claim) => `${batch.batch_id}/${claim.id}`));
  const expectedNanopubs = reference.nanopubs.filter((np) => claims.has(np.identifier));
  expect(
    actual.nanopubs.map(({ id, assertionId, provenanceId, pubinfoId }) => ({
      id,
      assertionId,
      provenanceId,
      pubinfoId,
    })),
  ).toEqual(
    expectedNanopubs.map(({ id, assertionId, provenanceId, pubinfoId }) => ({
      id,
      assertionId,
      provenanceId,
      pubinfoId,
    })),
  );
  const graphs = new Set([
    pkgId("batch", batch.batch_id, "sources"),
    pkgId("batch", batch.batch_id, "entities"),
    ...expectedNanopubs.flatMap((np) => [np.id, np.assertionId, np.provenanceId, np.pubinfoId]),
  ]);
  const expected = new Store(
    [...reference.dataset].filter(
      (q) =>
        graphs.has(q.graph.value) &&
        !(count < 5 && q.predicate.value === "http://www.w3.org/ns/prov#invalidatedAtTime"),
    ),
  );
  const engine = createRdfEngine();
  try {
    expect(await engine.canonicalize(actual.dataset)).toBe(await engine.canonicalize(expected));
  } finally {
    engine.dispose();
  }
});
