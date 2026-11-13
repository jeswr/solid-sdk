// AUTHORED-BY Claude Opus 5.5
import type { Quad, Term } from "@rdfjs/types";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory as df, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildNanopublications,
  createFactAssertion,
  MAX_SHARED_GRAPH_BLANK_NODES,
  MAX_SHARED_GRAPH_ROUNDS,
  mergeNanopublications,
  type Nanopublications,
  parseNanopublications,
  parseNanopublicationsTolerant,
  pkgId,
  readNanopubProvenance,
  serializeNanopublications,
} from "../src/index.js";
import { NS, parseReferenceRdf, RdfNode } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
const document = "https://example.org/documents/fictional-record";

/** A fictional batch with one document source and quoted (blank-node) evidence. */
async function batch(
  batchId: string,
  name: string,
  extra: { entities?: boolean } = {},
): Promise<Nanopublications> {
  return parseNanopublications(
    await serializeNanopublications(
      await buildNanopublications(
        {
          batch_id: batchId,
          worker: { agent_id: "https://example.org/agents/reader", agent_label: "Fictional" },
          sources: [{ id: "doc", kind: "document", url: document, title: "Fictional record" }],
          ...(extra.entities
            ? { entities: [{ id: "https://example.org/entities/thing", label: "Fictional" }] }
            : {}),
          claims: [
            {
              id: name,
              assertion: createFactAssertion(options.owner, {
                template: "allergy",
                value: { id: `https://example.org/entities/${name}`, name: `Fictional ${name}` },
              }),
              epistemic: "SelfReportedExplicit",
              evidence: [{ source: "doc", quote: `Fictional ${name} quote.` }],
            },
          ],
        },
        options,
      ),
    ),
  );
}
const sources = (value: Nanopublications, batchId: string) =>
  new NamedGraphDataset(df.namedNode(pkgId("batch", batchId, "sources")), value.dataset, df);
const blanks = (value: Nanopublications) =>
  new Set(
    [...value.dataset].flatMap((q) =>
      [q.subject, q.object].filter((t) => t.termType === "BlankNode").map((t) => t.value),
    ),
  );
/** Copy a dataset, renaming its blank nodes to the given labels (a forced collision). */
function renamed(value: Nanopublications, labels: string[]): Nanopublications {
  const names = new Map<string, string>();
  const rename = <T extends Term>(term: T): T => {
    if (term.termType !== "BlankNode") return term;
    if (!names.has(term.value)) names.set(term.value, labels[names.size] as string);
    return df.blankNode(names.get(term.value)) as unknown as T;
  };
  const dataset = new Store(
    [...value.dataset].map((q) =>
      df.quad(rename(q.subject), q.predicate, rename(q.object), q.graph),
    ),
  );
  return { ...value, dataset: dataset as Nanopublications["dataset"] };
}
const conflict = "Conflicting nanopublication merge";

describe("mergeNanopublications", () => {
  it("unions independent batches, keeps provenance and unions affected", async () => {
    const a = { ...(await batch("fictional-a", "one")), affected: ["urn:example:a"] };
    const b = { ...(await batch("fictional-b", "two")), affected: ["urn:example:b"] };
    const merged = mergeNanopublications(a, b);
    expect(merged.nanopubs.map((np) => np.id)).toEqual(
      [...a.nanopubs, ...b.nanopubs].map((np) => np.id).sort(),
    );
    expect(merged.affected).toEqual(["urn:example:a", "urn:example:b"]);
    expect(mergeNanopublications(b, a).affected).toEqual(["urn:example:b", "urn:example:a"]);
    const plainA = await batch("fictional-a", "one");
    const plainB = await batch("fictional-b", "two");
    expect(mergeNanopublications(plainA, plainB).affected).toEqual([]);
    for (const np of merged.nanopubs)
      expect(readNanopubProvenance(merged, np).sources[0]?.title).toBe("Fictional record");
    // The merged value is an ordinary, serializable nanopub collection.
    const reparsed = await parseNanopublications(await serializeNanopublications(merged));
    expect(reparsed.nanopubs).toHaveLength(2);
    expect(merged.dataset.size).toBe(a.dataset.size + b.dataset.size);
  });

  it("keeps one copy of identical shared graphs, including blank-node graphs", async () => {
    const a = await batch("fictional-a", "one");
    const again = await parseNanopublications(await serializeNanopublications(a));
    expect([...blanks(a)].some((label) => blanks(again).has(label))).toBe(false);
    const merged = mergeNanopublications(a, again);
    expect(merged.nanopubs).toHaveLength(1);
    expect(merged.dataset.size).toBe(a.dataset.size);
  });

  it("relabels blank nodes per input so colliding labels stay distinct", async () => {
    const a = await batch("fictional-a", "one");
    const b = await batch("fictional-b", "two");
    const labels = [...blanks(a)];
    const forced = renamed(b, labels);
    expect([...blanks(forced)].sort()).toEqual([...labels].sort());
    const merged = mergeNanopublications(a, forced);
    expect(blanks(merged).size).toBe(labels.length * 2);
    const reparsed = await parseNanopublications(await serializeNanopublications(merged));
    expect(reparsed.nanopubs.map((np) => np.evidence[0]?.quote).sort()).toEqual([
      "Fictional one quote.",
      "Fictional two quote.",
    ]);
  });

  it("refuses a foreign export that adds source fields under a reused batch ID", async () => {
    const victim = await batch("fictional-victim", "one");
    const forger = await batch("fictional-forger", "two");
    // Copy the victim's batch sources graph into the foreign export unchanged: accepted.
    for (const q of sources(victim, "fictional-victim")) sources(forger, "fictional-victim").add(q);
    expect(mergeNanopublications(victim, forger).nanopubs).toHaveLength(2);
    // Then forge a conversation kind and thread on the victim's source: refused.
    const forged = new RdfNode(document, sources(forger, "fictional-victim"));
    forged.link(`${NS.rdf}type`, `${NS.schema}Conversation`);
    forged.text(`${NS.schema}provider`, "Claude Code");
    forged.text(`${NS.dcterms}identifier`, "fictional-forged-thread");
    expect(() => mergeNanopublications(victim, forger)).toThrow(conflict);
    expect(() => mergeNanopublications(forger, victim)).toThrow(conflict);
  });

  it("refuses a tolerant foreign nanopub that claims the victim's batch with other records", async () => {
    const victim = await batch("fictional-victim", "one");
    const built = await buildNanopublications(
      {
        batch_id: "fictional-victim",
        worker: { agent_id: "https://example.org/agents/reader", agent_label: "Fictional" },
        sources: [{ id: "doc", kind: "document", url: document, title: "Forged title" }],
        claims: [
          {
            id: "two",
            assertion: createFactAssertion(options.owner, {
              template: "allergy",
              value: { id: "https://example.org/entities/two", name: "Fictional two" },
            }),
            epistemic: "SelfReportedExplicit",
          },
        ],
      },
      options,
    );
    const forger = await parseNanopublicationsTolerant(await serializeNanopublications(built));
    const message = (() => {
      try {
        mergeNanopublications(victim, forger);
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).toBe(conflict);
    expect(message).not.toContain("Forged");
  });

  it("refuses a batch graph that one input's nanopubs read but only the other supplies", async () => {
    const a = await batch("fictional-a", "one");
    const b = await batch("fictional-a", "two", { entities: true });
    expect(a.dataset.countQuads(null, null, null, pkgId("batch", "fictional-a", "entities"))).toBe(
      0,
    );
    expect(() => mergeNanopublications(a, b)).toThrow(conflict);
    expect(() => mergeNanopublications(b, a)).toThrow(conflict);
  });

  it("refuses a private envelope graph claimed by two nanopubs", async () => {
    const a = await batch("fictional-a", "one");
    const np = a.nanopubs[0] as (typeof a.nanopubs)[number];
    const b = { ...a, nanopubs: [{ ...np, id: "urn:uuid:00000000-0000-5000-8000-000000000000" }] };
    expect(() => mergeNanopublications(a, b)).toThrow(conflict);
  });

  it("refuses malformed metadata with the same fixed error", async () => {
    const a = await batch("fictional-a", "one");
    const np = a.nanopubs[0] as (typeof a.nanopubs)[number];
    new RdfNode(np.id, new NamedGraphDataset(df.namedNode(np.provenanceId), a.dataset, df)).link(
      `${NS.pkg}correspondenceBatch`,
      "https://example.org/private-secret",
    );
    expect(() => mergeNanopublications(a, a)).toThrow(conflict);
  });

  describe("graph comparison", () => {
    const turtle = async (body: string): Promise<Quad[]> => [
      ...(await parseReferenceRdf(`@prefix ex: <https://example.org/> . ${body}`, "text/turtle")),
    ];
    const entities = (value: Nanopublications) =>
      new NamedGraphDataset(
        df.namedNode(pkgId("batch", "fictional-a", "entities")),
        value.dataset,
        df,
      );
    /** A batch whose (declared) entities graph holds the given Turtle. */
    const withEntities = async (body: string, claim = "one") => {
      const value = await batch("fictional-a", claim);
      for (const q of await turtle(body)) entities(value).add(q);
      return value;
    };

    it("compares shared graphs by content and by blank-node structure", async () => {
      const shape = 'ex:s ex:p [ ex:q "1" ], [ ex:q "2" ] .';
      const merged = mergeNanopublications(await withEntities(shape), await withEntities(shape));
      expect([...entities(merged)]).toHaveLength(4);
      const plain = 'ex:s ex:p "1" .';
      expect(
        mergeNanopublications(await withEntities(plain), await withEntities(plain)).nanopubs,
      ).toHaveLength(1);
      // Same size and shape, different structure.
      const crossed = await withEntities('ex:s ex:p _:a, _:b . _:a ex:q "1", "2" .');
      const split = await withEntities('ex:s ex:p _:a, _:b . _:a ex:q "1" . _:b ex:q "2" .');
      expect(() => mergeNanopublications(crossed, split)).toThrow(conflict);
      const one = await withEntities(plain);
      const other = await withEntities('ex:s ex:p "2" .');
      const more = await withEntities('ex:s ex:p "1", "2" .');
      expect(() => mergeNanopublications(one, other)).toThrow(conflict);
      expect(() => mergeNanopublications(one, more)).toThrow(conflict);
      // A tied (cyclic) graph against a distinguishable one, in both orders.
      const cycle = await withEntities("_:a ex:p _:b . _:b ex:p _:c . _:c ex:p _:a .");
      const loop = await withEntities("_:a ex:p _:b . _:b ex:p _:c . _:c ex:p _:c .");
      expect(() => mergeNanopublications(cycle, loop)).toThrow(conflict);
      expect(() => mergeNanopublications(loop, cycle)).toThrow(conflict);
    });

    it("refuses many tied blank nodes in a shared graph quickly, even when identical", async () => {
      const tied = `ex:e ex:p ${Array.from({ length: 2000 }, (_, i) => `_:t${i}`).join(", ")} .`;
      const a = await withEntities(tied);
      const b = await withEntities(tied);
      const started = performance.now();
      expect(() => mergeNanopublications(a, b)).toThrow(conflict);
      const few = `ex:e ex:p ${Array.from({ length: 200 }, (_, i) => `_:t${i}`).join(", ")} .`;
      const c = await withEntities(few);
      const d = await withEntities(few);
      expect(() => mergeNanopublications(c, d)).toThrow(conflict);
      expect(performance.now() - started).toBeLessThan(1000);
    });

    it(`refuses more than ${MAX_SHARED_GRAPH_BLANK_NODES} blank nodes and over-long blank chains`, async () => {
      const distinct = (count: number) =>
        Array.from({ length: count }, (_, i) => `ex:e ex:p [ ex:v ${i} ] .`).join(" ");
      const atCap = distinct(MAX_SHARED_GRAPH_BLANK_NODES);
      expect(
        mergeNanopublications(await withEntities(atCap), await withEntities(atCap)).nanopubs,
      ).toHaveLength(1);
      const over = distinct(MAX_SHARED_GRAPH_BLANK_NODES + 1);
      const big = await withEntities(over);
      const big2 = await withEntities(over);
      expect(() => mergeNanopublications(big, big2)).toThrow(conflict);
      // A chain needs about half its length in rounds to tell its middle apart.
      const chain = (length: number) =>
        `ex:e ex:p _:c0 . ${Array.from({ length }, (_, i) => `_:c${i} ex:n _:c${i + 1} .`).join(" ")}`;
      const short = chain(2 * MAX_SHARED_GRAPH_ROUNDS - 4);
      expect(
        mergeNanopublications(await withEntities(short), await withEntities(short)).nanopubs,
      ).toHaveLength(1);
      const long = chain(2 * MAX_SHARED_GRAPH_ROUNDS + 4);
      const l1 = await withEntities(long);
      const l2 = await withEntities(long);
      expect(() => mergeNanopublications(l1, l2)).toThrow(conflict);
    });

    it("refuses a dropped duplicate whose blank nodes another kept graph references", async () => {
      const shape = 'ex:s ex:p _:k . _:k ex:q "1" .';
      const a = await withEntities(shape);
      const b = await withEntities(shape, "two");
      const blank = [...entities(b)].find((q) => q.subject.termType === "BlankNode")
        ?.subject as Quad["subject"];
      const np = b.nanopubs[0] as (typeof b.nanopubs)[number];
      new RdfNode(blank, new NamedGraphDataset(df.namedNode(np.provenanceId), b.dataset, df)).text(
        `${NS.rdfs}comment`,
        "Fictional",
      );
      expect(() => mergeNanopublications(a, b)).toThrow(conflict);
      expect(mergeNanopublications(b, a).nanopubs).toHaveLength(2);
    });

    it("drops graphs no nanopub reads, so planted data cannot block a later merge", async () => {
      const owner = await batch("fictional-owner-1", "one");
      const foreign = await batch("fictional-foreign", "two");
      // A planted batch graph for a guessable future batch, and default-graph data.
      new RdfNode(
        document,
        new NamedGraphDataset(
          df.namedNode(pkgId("batch", "fictional-owner-2", "sources")),
          foreign.dataset,
          df,
        ),
      ).text(`${NS.schema}name`, "Planted title");
      for (const q of await turtle('ex:s ex:p "Fictional default" .')) foreign.dataset.add(q);
      const merged = mergeNanopublications(owner, foreign);
      const graphs = merged.dataset.getGraphs(null, null, null).map((g) => g.value);
      expect(graphs).not.toContain(pkgId("batch", "fictional-owner-2", "sources"));
      expect(merged.dataset.countQuads(null, null, null, df.defaultGraph())).toBe(0);
      expect(
        mergeNanopublications(merged, await batch("fictional-owner-2", "three")).nanopubs,
      ).toHaveLength(3);
    });
  });
});
