// AUTHORED-BY Claude Sonnet 5.5
import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory as df, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNanopublications,
  classifyNanopublications,
  createFactAssertion,
  MAX_REPLACED_BY,
  type Nanopublication,
  type Nanopublications,
  parseNanopublications,
  parseNanopublicationsTolerant,
} from "../src/index.js";
import { NS } from "../src/rdf.js";

const owner = "https://example.org/people/avery#me";
const build = (claims: string[], same = false) =>
  buildNanopublications(
    {
      batch_id: "shared",
      worker: { agent_id: "https://example.org/agent", agent_label: "Fictional extractor" },
      claims: claims.map((id) => ({
        id,
        assertion: createFactAssertion(owner, {
          template: "condition",
          value: { id: `https://example.org/${same ? "same" : id}`, name: "Fictional condition" },
        }),
        epistemic: "SelfReportedExplicit" as const,
      })),
    },
    { owner, generatedAt: "2026-11-01T00:00:00Z" },
  );
const names = (count: number) => Array.from({ length: count }, (_, i) => `c${i}`);
const node = df.namedNode;

/** Point every head at one shared provenance (and pubinfo) graph holding all their quads. */
function share(value: Nanopublications, kinds: ("provenanceId" | "pubinfoId")[]): string[] {
  const shared: string[] = [];
  for (const kind of kinds) {
    const target = (value.nanopubs[0] as Nanopublication)[kind];
    shared.push(target);
    for (const np of value.nanopubs) {
      const from = np[kind];
      if (from === target) continue;
      for (const q of value.dataset.getQuads(null, null, null, node(from))) {
        value.dataset.removeQuad(q);
        value.dataset.addQuad(q.subject, q.predicate, q.object, node(target));
      }
      const link = kind === "provenanceId" ? "hasProvenance" : "hasPublicationInfo";
      value.dataset.removeQuad(node(np.id), node(NS.np + link), node(from), node(np.id));
      value.dataset.addQuad(node(np.id), node(NS.np + link), node(target), node(np.id));
    }
  }
  return shared;
}
const wholeGraphMatches = (spy: { mock: { calls: unknown[][] } }, name: string) =>
  spy.mock.calls.filter(
    ([s, p, o, g]) =>
      !s && !p && !o && g !== null && g !== undefined && (g as { value: string }).value === name,
  ).length;

afterEach(() => vi.restoreAllMocks());

describe("F4: heads sharing a provenance or pubinfo graph", () => {
  const count = 9;
  it("snapshots a shared graph once per strict read and once per classification", async () => {
    const built = await build(names(count));
    const [prov, info] = share(built, ["provenanceId", "pubinfoId"]) as [string, string];
    const trig = await serialize([...built.dataset], { format: "application/trig" });
    const match = vi.spyOn(Store.prototype, "match");
    const parsed = await parseNanopublications(trig);
    expect(parsed.nanopubs).toHaveLength(count);
    expect(wholeGraphMatches(match, prov)).toBe(1);
    expect(wholeGraphMatches(match, info)).toBe(1);
    match.mockClear();
    const classified = classifyNanopublications(parsed);
    expect(classified).toHaveLength(count);
    expect(wholeGraphMatches(match, prov)).toBe(1);
  });

  it("scans a shared metadata graph once when every head using it is skipped", async () => {
    const built = await build(names(count));
    const [prov] = share(built, ["provenanceId"]) as [string];
    built.dataset.addQuad(
      node("https://example.org/extra"),
      node(`${NS.schema}name`),
      df.literal("Fictional\u2028value"),
      node(prov),
    );
    const trig = await serialize([...built.dataset], { format: "application/trig" });
    const match = vi.spyOn(Store.prototype, "match");
    const result = await parseNanopublicationsTolerant(trig);
    expect(result.skipped).toHaveLength(count);
    expect(wholeGraphMatches(match, prov)).toBe(1);
  });
});

describe("F3: shared assertion graphs", () => {
  it("classifies envelopes that all revise one shared assertion, with a bounded replacedBy", async () => {
    const count = MAX_REPLACED_BY + 6;
    const built = await build(names(count), true);
    expect(new Set(built.nanopubs.map((np) => np.assertionId)).size).toBe(1);
    for (const np of built.nanopubs)
      built.dataset.addQuad(
        node(np.assertionId),
        node(`${NS.prov}wasRevisionOf`),
        node(np.assertionId),
        node(np.provenanceId),
      );
    const parsed = await parseNanopublications(
      await serialize([...built.dataset], { format: "application/trig" }),
    );
    const classified = classifyNanopublications(parsed);
    expect(classified).toHaveLength(count);
    expect(classified.every((np) => np.belief === "past")).toBe(true);
    expect(classified.every((np) => np.replacedBy.length === MAX_REPLACED_BY)).toBe(true);
  });
});
