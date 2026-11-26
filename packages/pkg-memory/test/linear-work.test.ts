// AUTHORED-BY Claude Sonnet 5.5
import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory as df, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNanopublications,
  classifyNanopublications,
  createFactAssertion,
  MAX_CLASSIFIED_NANOPUBLICATIONS,
  MAX_REPLACED_BY,
  type Nanopublication,
  type Nanopublications,
  parseNanopublications,
  parseNanopublicationsTolerant,
} from "../src/index.js";
import { NS, RdfNode } from "../src/rdf.js";

const node = df.namedNode;
const owner = "https://example.org/people/avery#me";
afterEach(() => vi.restoreAllMocks());

/** Hand-made heads: classification reads only the nanopub fields and its provenance graph. */
function heads(assertions: number, perAssertion: number, link: "all" | "none"): Nanopublications {
  const ids = Array.from({ length: assertions }, (_, i) => `https://example.org/a/${i}`);
  const nanopubs: Nanopublication[] = [];
  for (const [a, assertionId] of ids.entries())
    for (let k = 0; k < perAssertion; k++)
      nanopubs.push({
        id: `https://example.org/np/${String(a).padStart(4, "0")}-${String(k).padStart(4, "0")}`,
        assertionId,
        provenanceId: "https://example.org/shared-provenance",
        pubinfoId: `https://example.org/info/${a}-${k}`,
        epistemic: "Documented",
        validity: "Current",
        categories: [],
        attributedTo: [],
        evidence: [],
        supersedes: link === "all" ? ids : [],
        contradicts: [],
        batch: "b",
        identifier: `b/${a}-${k}`,
        generatedAt: "2026-11-01T00:00:00+00:00",
        agent: "https://example.org/agent",
      });
  return { dataset: new Store(), nanopubs };
}
function setAdds<T>(run: () => T): { result: T; adds: number } {
  const spy = vi.spyOn(Set.prototype, "add");
  const result = run();
  const adds = spy.mock.calls.length;
  spy.mockRestore();
  return { result, adds };
}

describe("R1: replacements are stored per assertion, not per envelope pair", () => {
  it("grows linearly with envelopes when many assertions revise each other", () => {
    const small = setAdds(() => classifyNanopublications(heads(20, 4, "all")));
    const large = setAdds(() => classifyNanopublications(heads(20, 16, "all")));
    // Four times the envelopes over the same assertion links: linear is ~4x, pairs are ~16x.
    expect(large.adds / small.adds).toBeLessThan(6);
    // At most one bounded replacedBy set per envelope, plus the shared work.
    expect(large.adds).toBeLessThan(80 * 320);
    // The all-supersede-all shape: every envelope is past, its replacedBy is bounded and sorted.
    for (const np of large.result) {
      expect(np.belief).toBe("past");
      expect(np.replacedBy.length).toBeLessThanOrEqual(MAX_REPLACED_BY);
      expect(np.replacedBy).toEqual([...np.replacedBy].sort());
      expect(np.replacedBy).not.toContain(np.id);
    }
  });

  it("keeps the smallest replacer ids, excluding the envelope itself", () => {
    const value = heads(1, 70, "all");
    const result = classifyNanopublications(value);
    const ids = value.nanopubs.map((np) => np.id).sort();
    expect(result.find((np) => np.id === ids[0])?.replacedBy).toEqual(
      ids.slice(1, 1 + MAX_REPLACED_BY),
    );
    expect(result.find((np) => np.id === ids[69])?.replacedBy).toEqual(
      ids.slice(0, MAX_REPLACED_BY),
    );
  });

  it("lets an envelope-scoped revision take precedence over its assertion-wide links", () => {
    const value = heads(2, 1, "all");
    const [first, second] = value.nanopubs as [Nanopublication, Nanopublication];
    // `second` names `first` directly, so its assertion-wide links are ignored.
    value.dataset.addQuad(
      node(second.id),
      node(`${NS.prov}wasRevisionOf`),
      node(first.id),
      node(second.provenanceId),
    );
    const result = classifyNanopublications(value);
    expect(result.find((np) => np.id === first.id)).toMatchObject({
      belief: "past",
      replacedBy: [second.id],
    });
    // `first` still revises every assertion, `second`'s assertion included.
    expect(result.find((np) => np.id === second.id)).toMatchObject({
      belief: "past",
      replacedBy: [first.id],
    });
  });

  it("does not let an envelope replace itself through its own assertion", () => {
    const [only] = heads(1, 1, "all").nanopubs as [Nanopublication];
    const [result] = classifyNanopublications({ dataset: new Store(), nanopubs: [only] });
    expect(result).toMatchObject({ belief: "definitely", replacedBy: [] });
  });

  it("marks every other envelope of an assertion replaced by one revising envelope", () => {
    const value = heads(2, 3, "none");
    const reviser = value.nanopubs[3] as Nanopublication;
    reviser.supersedes = ["https://example.org/a/0"];
    const result = classifyNanopublications(value);
    expect(result.filter((np) => np.belief === "past").map((np) => np.assertionId)).toEqual([
      "https://example.org/a/0",
      "https://example.org/a/0",
      "https://example.org/a/0",
    ]);
    expect(result.filter((np) => np.belief !== "past")).toHaveLength(3);
  });
});

describe("R3: many envelopes of one assertion never refuse the read", () => {
  it("classifies far more envelopes of one assertion than any former per-assertion limit", () => {
    const result = classifyNanopublications(heads(1, 500, "none"));
    expect(result).toHaveLength(500);
    expect(result.every((np) => np.belief === "definitely" && np.corroboration === 500)).toBe(true);
  });

  it("still refuses a read above the total maximum, before reading any graph", () => {
    const value = heads(1, 1, "none");
    value.nanopubs = Array.from({ length: MAX_CLASSIFIED_NANOPUBLICATIONS + 1 }, (_, i) => ({
      ...(value.nanopubs[0] as Nanopublication),
      id: `https://example.org/np/${i}`,
    }));
    const match = vi.spyOn(Store.prototype, "match");
    expect(() => classifyNanopublications(value)).toThrow("Too many nanopublications");
    expect(match).not.toHaveBeenCalled();
  });
});

describe("R2: parse-time reads", () => {
  /** N identical claims, so every envelope shares one assertion; provenance shared too. */
  async function shared(count: number, revisions: number) {
    const built = await buildNanopublications(
      {
        batch_id: "linear",
        worker: { agent_id: "https://example.org/agent", agent_label: "Fictional" },
        claims: Array.from({ length: count }, (_, i) => ({
          id: `c${i}`,
          assertion: createFactAssertion(owner, {
            template: "condition",
            value: { id: "https://example.org/same", name: "Fictional condition" },
          }),
          epistemic: "SelfReportedExplicit" as const,
        })),
      },
      { owner, generatedAt: "2026-11-01T00:00:00Z" },
    );
    const target = (built.nanopubs[0] as Nanopublication).provenanceId;
    const subject = (built.nanopubs[0] as Nanopublication).assertionId;
    for (const np of built.nanopubs) {
      for (const q of built.dataset.getQuads(null, null, null, node(np.provenanceId))) {
        built.dataset.removeQuad(q);
        built.dataset.addQuad(q.subject, q.predicate, q.object, node(target));
      }
      built.dataset.removeQuad(
        node(np.id),
        node(`${NS.np}hasProvenance`),
        node(np.provenanceId),
        node(np.id),
      );
      built.dataset.addQuad(node(np.id), node(`${NS.np}hasProvenance`), node(target), node(np.id));
    }
    for (let i = 0; i < revisions; i++)
      built.dataset.addQuad(
        node(subject),
        node(`${NS.prov}wasRevisionOf`),
        node(`https://example.org/old/${i}`),
        node(target),
      );
    return serialize([...built.dataset], { format: "application/trig" });
  }

  it("never counts a whole graph per head, and reads shared assertion metadata once", async () => {
    const trig = await shared(12, 30);
    const count = vi.spyOn(Store.prototype, "countQuads");
    const terms = vi.spyOn(RdfNode.prototype, "terms");
    for (const parse of [
      (text: string) => parseNanopublications(text),
      parseNanopublicationsTolerant,
    ]) {
      count.mockClear();
      terms.mockClear();
      const parsed = await parse(trig);
      expect(parsed.nanopubs).toHaveLength(12);
      expect(parsed.nanopubs.every((np) => np.supersedes.length === 30)).toBe(true);
      expect(count).not.toHaveBeenCalled();
      const revisionReads = terms.mock.calls.filter(([p]) => p === `${NS.prov}wasRevisionOf`);
      expect(revisionReads).toHaveLength(1);
    }
  });

  it("refuses more heads than the maximum before reading any graph, strict and tolerant", async () => {
    const heads = Array.from(
      { length: MAX_CLASSIFIED_NANOPUBLICATIONS + 1 },
      (_, i) => `<urn:h:${i}> { <urn:h:${i}> np:hasAssertion <urn:a:${i}> . }`,
    ).join("\n");
    const trig = `@prefix np: <${NS.np}> .\n${heads}`;
    const match = vi.spyOn(Store.prototype, "match");
    const count = vi.spyOn(Store.prototype, "countQuads");
    for (const parse of [
      (text: string) => parseNanopublications(text),
      parseNanopublicationsTolerant,
    ])
      await expect(parse(trig)).rejects.toThrow("Too many nanopublications");
    expect(count).not.toHaveBeenCalled();
    expect(match.mock.calls.filter(([, , , g]) => g)).toHaveLength(0);
  }, 60_000);
});
