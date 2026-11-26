// AUTHORED-BY Claude Sonnet 5.5
import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory as df, type Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildNanopublications,
  classifyNanopublications,
  createFactAssertion,
  mergeNanopublications,
  type Nanopublications,
  parseNanopublicationsTolerant,
} from "../src/index.js";
import { graph, NS, putGraph, RdfNode } from "../src/rdf.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fictional fixture");
  return value;
}
const owner = "https://example.org/people/avery#me";
async function fixture() {
  return buildNanopublications(
    {
      batch_id: "split",
      worker: { agent_id: "https://example.org/agent", agent_label: "Fictional extractor" },
      claims: ["a", "b", "c"].map((id) => ({
        id,
        assertion: createFactAssertion(owner, {
          template: "condition",
          value: { id: `https://example.org/${id}`, name: `Fictional ${id}` },
        }),
        epistemic: "SelfReportedExplicit" as const,
      })),
    },
    { owner, generatedAt: "2026-11-01T00:00:00Z" },
  );
}
const quadsOf = (dataset: Store, names: string[]) =>
  names.flatMap((name) => dataset.getQuads(null, null, null, df.namedNode(name)));
const trig = (dataset: Store, names: string[]) =>
  serialize(quadsOf(dataset, names), { format: "application/trig" });
const envelope = (np: {
  id: string;
  assertionId: string;
  provenanceId: string;
  pubinfoId: string;
}) => [np.id, np.assertionId, np.provenanceId, np.pubinfoId];

/** File A holds claim a (and c); file B holds only an unreadable update naming a. */
async function twoFiles(predicate: string, target: "id" | "assertionId") {
  const value = await fixture();
  const [a, b, c] = value.nanopubs.map(required);
  const prov = graph(value.dataset, required(b).provenanceId);
  new RdfNode(required(b).id, prov).link(predicate, required(a)[target]);
  putGraph(value.dataset, required(b).provenanceId, prov);
  value.dataset.addQuad(
    df.namedNode("https://example.org/extra"),
    df.namedNode(`${NS.schema}name`),
    df.literal("Fictional\u2028value"),
    df.namedNode(required(b).provenanceId),
  );
  const fileA = await parseNanopublicationsTolerant(
    await trig(value.dataset, [...envelope(required(a)), ...envelope(required(c))]),
  );
  const fileB = await parseNanopublicationsTolerant(
    await trig(value.dataset, envelope(required(b))),
  );
  return { a: required(a), c: required(c), fileA, fileB };
}

describe("an unreadable update in one input marks its target in the other", () => {
  it.each([
    [`${NS.prov}wasRevisionOf`, "id"],
    [`${NS.prov}wasRevisionOf`, "assertionId"],
    [`${NS.pkg}contradicts`, "id"],
    [`${NS.pkg}contradicts`, "assertionId"],
  ] as const)("%s targeting the %s", async (predicate, target) => {
    const { a, c, fileA, fileB } = await twoFiles(predicate, target);
    expect(fileB.skipped).toHaveLength(1);
    expect(fileB.nanopubs).toHaveLength(0);
    expect(fileA.affected).toEqual([]);
    for (const merged of [
      mergeNanopublications(fileA, fileB),
      mergeNanopublications(fileB, fileA),
    ]) {
      expect(merged.affected).toEqual([a.id]);
      const facts = classifyNanopublications(merged);
      expect(facts.find((f) => f.id === a.id)).toMatchObject({
        belief: "might",
        affectedBySkipped: true,
      });
      expect(facts.find((f) => f.id === c.id)).toMatchObject({ belief: "definitely" });
    }
  });

  it("carries unresolved targets through a further merge, as IRIs only", async () => {
    const { a, fileA, fileB } = await twoFiles(`${NS.prov}wasRevisionOf`, "id");
    expect(fileB.skippedTargets).toEqual([a.id]);
    const middle = mergeNanopublications(fileB, { dataset: fileB.dataset, nanopubs: [] });
    expect(middle.skippedTargets).toEqual([a.id]);
    expect(mergeNanopublications(middle, fileA).affected).toEqual([a.id]);
    expect(JSON.stringify(fileB.skippedTargets)).not.toContain("Fictional");
  });

  it("drops unsafe target IRIs instead of reporting them", async () => {
    const value = await fixture();
    const [a, b] = value.nanopubs.map(required);
    const prov = graph(value.dataset, required(b).provenanceId);
    new RdfNode(required(b).id, prov).add(
      `${NS.prov}wasRevisionOf`,
      df.namedNode("javascript:alert(1)"),
    );
    putGraph(value.dataset, required(b).provenanceId, prov);
    value.dataset.addQuad(
      df.namedNode("https://example.org/extra"),
      df.namedNode(`${NS.schema}name`),
      df.literal("Fictional\u2028value"),
      df.namedNode(required(b).provenanceId),
    );
    const parsed = await parseNanopublicationsTolerant(
      await trig(value.dataset, envelope(required(b))),
    );
    expect(parsed.skipped).toHaveLength(1);
    expect(parsed.skippedTargets).toEqual([]);
    expect(required(a).id).toBeDefined();
  });

  it("tolerates inputs without a skippedTargets list", async () => {
    const { fileA } = await twoFiles(`${NS.prov}wasRevisionOf`, "id");
    const plain: Nanopublications = { dataset: fileA.dataset, nanopubs: fileA.nanopubs };
    expect(mergeNanopublications(plain, plain).skippedTargets).toEqual([]);
  });
});
