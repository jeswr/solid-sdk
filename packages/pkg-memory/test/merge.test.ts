// AUTHORED-BY Claude Opus 5.5
import type { Quad, Term } from "@rdfjs/types";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory as df, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildNanopublications,
  createFactAssertion,
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
    const withDefault = async (body: string) => {
      const value = await batch("fictional-a", "one");
      for (const q of await turtle(body)) value.dataset.add(q);
      return value;
    };

    it("compares default graphs by content and by blank-node structure", async () => {
      const shape = 'ex:s ex:p [ ex:q "1" ], [ ex:q "2" ] .';
      const merged = mergeNanopublications(await withDefault(shape), await withDefault(shape));
      expect(merged.dataset.countQuads(null, null, null, df.defaultGraph())).toBe(4);
      const plain = 'ex:s ex:p "1" .';
      expect(
        mergeNanopublications(await withDefault(plain), await withDefault(plain)).nanopubs,
      ).toHaveLength(1);
      // Same size and shape, different structure: canonical labelling refuses it.
      const crossed = await withDefault('ex:s ex:p _:a, _:b . _:a ex:q "1", "2" .');
      const split = await withDefault('ex:s ex:p _:a, _:b . _:a ex:q "1" . _:b ex:q "2" .');
      expect(() => mergeNanopublications(crossed, split)).toThrow(conflict);
      const one = await withDefault(plain);
      const other = await withDefault('ex:s ex:p "2" .');
      const more = await withDefault('ex:s ex:p "1", "2" .');
      expect(() => mergeNanopublications(one, other)).toThrow(conflict);
      expect(() => mergeNanopublications(one, more)).toThrow(conflict);
    });

    it("never treats blank-named graphs as shared", async () => {
      const graphQuads = async (value: Nanopublications) => {
        for (const q of await turtle('ex:s ex:p "1" .'))
          value.dataset.add(df.quad(q.subject, q.predicate, q.object, df.blankNode("g")));
        return value;
      };
      const merged = mergeNanopublications(
        await graphQuads(await batch("fictional-a", "one")),
        await graphQuads(await batch("fictional-b", "two")),
      );
      expect(
        merged.dataset.getGraphs(null, null, null).filter((g) => g.termType === "BlankNode"),
      ).toHaveLength(2);
    });

    it("refuses a dropped duplicate whose blank nodes another kept graph references", async () => {
      const shape = 'ex:s ex:p _:k . _:k ex:q "1" .';
      const a = await withDefault(shape);
      const b = await withDefault(shape);
      const blank = [...b.dataset.match(null, null, null, df.defaultGraph())].find(
        (q) => q.subject.termType === "BlankNode",
      )?.subject as Quad["subject"];
      const extra = df.namedNode("https://example.org/graphs/fictional-extra");
      new RdfNode(blank, new NamedGraphDataset(extra, b.dataset, df)).text(
        `${NS.rdfs}comment`,
        "Fictional",
      );
      expect(() => mergeNanopublications(a, b)).toThrow(conflict);
    });
  });
});
