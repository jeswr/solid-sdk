// AUTHORED-BY Claude Sonnet 5.5
import { mergeNanopublications } from "@jeswr/pkg-memory";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory as df, type Store, Writer } from "n3";
import { expect, it } from "vitest";
import { importHealthExport, projectHealthFacts } from "../src/index.js";
import { batch, claim, condition, FixtureNode, owner, S } from "./helpers.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fictional fixture");
  return value;
}
function external(dataset: Store, names: Set<string>): Promise<string> {
  const writer = new Writer({ format: "application/trig" });
  writer.addQuads(
    [...dataset].filter((q) => q.graph.termType === "NamedNode" && names.has(q.graph.value)),
  );
  return new Promise((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
}

it("keeps a fact uncertain when its retraction is skipped in a different export", async () => {
  const value = await batch([
    claim("a", condition("Fictional original", "a")),
    { ...claim("b", condition("Fictional revision", "b")), supersedes: ["a"] },
    claim("unrelated", condition("Fictional unrelated", "unrelated")),
  ]);
  const byIdentifier = (suffix: string) =>
    required(value.nanopubs.find((np) => np.identifier.endsWith(`/${suffix}`)));
  const a = byIdentifier("a"),
    b = byIdentifier("b");
  const envelope = (np: typeof a) => [np.id, np.assertionId, np.provenanceId, np.pubinfoId];
  const bGraphs = new Set(envelope(b));
  const poisonedGraph = b.pubinfoId;
  new FixtureNode(
    "https://example.org/extra",
    new NamedGraphDataset(df.namedNode(poisonedGraph), value.dataset, df),
  ).text(`${S}name`, "Fictional value");
  const everything = new Set(value.dataset.getGraphs(null, null, null).map((graph) => graph.value));
  const first = await importHealthExport(
    await external(value.dataset, new Set([...everything].filter((name) => !bGraphs.has(name)))),
    { owner },
  );
  const second = await importHealthExport(await external(value.dataset, bGraphs), { owner });
  expect(second.skipped.count).toBe(1);
  expect(second.value.nanopubs).toHaveLength(0);
  // Alone, the first export shows its fact as definite: it cannot see the update.
  expect(projectHealthFacts(first.value, { owner }).facts.find((f) => f.id === a.id)).toMatchObject(
    {
      belief: "definitely",
    },
  );

  const merged = mergeNanopublications(first.value, second.value);
  const view = projectHealthFacts(merged, { owner });
  expect(view.facts.find((f) => f.id === a.id)).toMatchObject({
    belief: "might",
    affectedBySkipped: true,
  });
  expect(view.facts.find((f) => f.label === "Fictional unrelated")).toMatchObject({
    belief: "definitely",
    affectedBySkipped: undefined,
  });
});
