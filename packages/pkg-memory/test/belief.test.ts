// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee these entries. */
import { readFile } from "node:fs/promises";
import { DataFactory as df } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  buildNanopublications,
  type Claim,
  classifyNanopublications,
  createFactAssertion,
  EPISTEMIC_STATUSES,
  parseNanopublications,
  serializeNanopublications,
  VALIDITY_STATUSES,
} from "../src/index.js";
import { graph, NS, putGraph, RdfNode, ReferenceStore } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
const assertion = (value: string) =>
  createFactAssertion(options.owner, { template: "email", value: `${value}@example.org` });
const build = (claims: Claim[]) =>
  buildNanopublications(
    {
      batch_id: "belief",
      worker: { agent_id: "https://example.org/client", agent_label: "Test" },
      claims,
    },
    options,
  );

describe("KG §4.1 belief view", () => {
  it.each([
    "Literal",
    "BlankNode",
  ])("ignores %s envelope revision targets even when their value is an existing ID", async (kind) => {
    const value = await build([
      { id: "old", epistemic: "SelfReportedExplicit", assertion: assertion("old") },
      { id: "new", epistemic: "SelfReportedExplicit", assertion: assertion("new") },
    ]);
    const old = value.nanopubs.find((np) => np.identifier === "belief/old")!;
    const newer = value.nanopubs.find((np) => np.identifier === "belief/new")!;
    const provenance = graph(value.dataset, newer.provenanceId);
    new RdfNode(newer.id, provenance).add(
      `${NS.prov}wasRevisionOf`,
      kind === "Literal" ? df.literal(old.id) : df.blankNode(old.id),
    );
    putGraph(value.dataset, newer.provenanceId, provenance);
    expect(classifyNanopublications(value).find((np) => np.id === old.id)).toMatchObject({
      belief: "definitely",
      replacedBy: [],
    });
    // Invalid envelope objects must not suppress a valid assertion revision.
    newer.supersedes.push(old.assertionId);
    expect(classifyNanopublications(value).find((np) => np.id === old.id)).toMatchObject({
      belief: "past",
      replacedBy: [newer.id],
    });
  });

  it.each([
    df.namedNode("https://example.org/time"),
    df.blankNode("time"),
    df.literal(options.generatedAt),
    df.literal("invalid-time", df.namedNode(`${NS.xsd}dateTime`)),
  ])("ignores malformed invalidation objects in derived belief: %j", async (term) => {
    const value = await build([
      { id: "one", epistemic: "SelfReportedExplicit", assertion: assertion("one") },
    ]);
    const np = value.nanopubs[0]!;
    const provenance = graph(value.dataset, np.provenanceId);
    new RdfNode(np.assertionId, provenance).add(`${NS.prov}invalidatedAtTime`, term);
    putGraph(value.dataset, np.provenanceId, provenance);
    expect(classifyNanopublications(value)[0]!.belief).toBe("definitely");
    await expect(parseNanopublications(await serializeNanopublications(value))).rejects.toThrow();
  });

  it.each([
    "envelope revision",
    "assertion revision",
    "contradiction",
  ])("rejects non-IRI %s objects in the parser", async (kind) => {
    for (const term of [df.literal("urn:uuid:target"), df.blankNode("target")]) {
      const value = await build([
        { id: "one", epistemic: "SelfReportedExplicit", assertion: assertion("one") },
      ]);
      const np = value.nanopubs[0]!;
      const provenance = graph(value.dataset, np.provenanceId);
      new RdfNode(kind === "envelope revision" ? np.id : np.assertionId, provenance).add(
        kind === "contradiction" ? `${NS.pkg}contradicts` : `${NS.prov}wasRevisionOf`,
        term,
      );
      putGraph(value.dataset, np.provenanceId, provenance);
      await expect(parseNanopublications(await serializeNanopublications(value))).rejects.toThrow(
        "Expected IRI",
      );
    }
  });
  it.each([24, 48])("bounds provenance reads linearly for %i unrelated nanopubs", async (count) => {
    const value = await build(
      Array.from({ length: count }, (_, i) => ({
        id: String(i),
        epistemic: "SelfReportedExplicit",
        assertion: assertion(String(i)),
      })),
    );
    const match = vi.spyOn(value.dataset, "match");
    const result = classifyNanopublications(value);
    expect(result).toHaveLength(count);
    expect(result.every((np) => np.belief === "definitely" && np.corroboration === 1)).toBe(true);
    expect(match.mock.calls.length).toBeLessThanOrEqual(count * 2);
    match.mockRestore();
  });

  it("indexes multiple revisions and ignores missing and self-only revision targets", async () => {
    const value = await build([
      { id: "old", epistemic: "SelfReportedExplicit", assertion: assertion("old") },
      {
        id: "new",
        epistemic: "SelfReportedExplicit",
        assertion: assertion("new"),
        supersedes: ["old"],
      },
      {
        id: "alternative",
        epistemic: "SelfReportedExplicit",
        assertion: assertion("alternative"),
        supersedes: ["old"],
      },
    ]);
    const old = value.nanopubs.find((np) => np.identifier === "belief/old")!;
    const newer = value.nanopubs.find((np) => np.identifier === "belief/new")!;
    const alternative = value.nanopubs.find((np) => np.identifier === "belief/alternative")!;
    newer.supersedes.push(newer.assertionId, "urn:uuid:missing");
    const result = classifyNanopublications(value);
    expect(result.find((np) => np.id === old.id)).toMatchObject({
      belief: "past",
      replacedBy: [newer.id, alternative.id].sort(),
    });
    expect(result.find((np) => np.id === newer.id)).toMatchObject({
      belief: "definitely",
      replacedBy: [],
    });
  });

  it("classifies the independent Python synthetic oracle without altering its dataset", async () => {
    const value = await parseNanopublications(
      await readFile(new URL("./fixtures/synthetic.expected.trig", import.meta.url), "utf8"),
    );
    const before = [...value.dataset];
    expect(
      Object.fromEntries(
        classifyNanopublications(value).map((np) => [np.identifier.split("/")[1], np.belief]),
      ),
    ).toEqual({
      address: "past",
      preference: "might",
      medication: "definitely",
      condition: "might",
      relationship: "might",
    });
    expect([...value.dataset]).toEqual(before);
  });

  it.each(EPISTEMIC_STATUSES)("covers every validity for %s", async (epistemic) => {
    const claims = VALIDITY_STATUSES.map((validity) => ({
      id: validity,
      epistemic,
      validity,
      assertion: assertion(validity),
    }));
    const classified = classifyNanopublications(await build(claims));
    for (const np of classified) {
      const expected = ["Superseded", "Historical", "Retracted"].includes(np.validity)
        ? "past"
        : epistemic === "Mentioned"
          ? "mentioned"
          : np.validity === "Contradicted"
            ? "might"
            : ["Documented", "DocumentedViaSummary", "SelfReportedExplicit"].includes(epistemic)
              ? "definitely"
              : "might";
      expect(np.belief).toBe(expected);
    }
  });

  it("honours contradiction in both directions and unresolved targets", async () => {
    const value = await build([
      {
        id: "one",
        epistemic: "SelfReportedExplicit",
        assertion: assertion("one"),
        contradicts: ["two"],
      },
      { id: "two", epistemic: "DocumentedViaSummary", assertion: assertion("two") },
      { id: "three", epistemic: "Documented", assertion: assertion("three"), contradicts: ["one"] },
    ]);
    const byId = Object.fromEntries(
      classifyNanopublications(value).map((np) => [np.identifier, np.belief]),
    );
    expect(byId).toEqual({
      "belief/one": "might",
      "belief/two": "might",
      "belief/three": "definitely",
    });
    value.nanopubs = value.nanopubs.filter((np) => np.identifier !== "belief/two");
    expect(
      classifyNanopublications(value).find((np) => np.identifier === "belief/one")!.belief,
    ).toBe("might");
  });

  it.each([
    "Mentioned",
    "SelfReportedExplicit",
  ] as const)("%s contributes contradictions only when it asserts a belief, in either link direction", async (epistemic) => {
    for (const outgoing of [false, true]) {
      const value = await build([
        {
          id: "fact",
          epistemic: "SelfReportedExplicit",
          assertion: assertion("fact"),
          contradicts: outgoing ? ["other"] : [],
        },
        {
          id: "other",
          epistemic,
          assertion: assertion("other"),
          contradicts: outgoing ? [] : ["fact"],
        },
      ]);
      for (const nanopubs of [value.nanopubs, [...value.nanopubs].reverse()]) {
        const result = classifyNanopublications({ ...value, nanopubs });
        expect(result.find((np) => np.identifier === "belief/fact")).toMatchObject({
          belief: epistemic === "Mentioned" ? "definitely" : "might",
          replacedBy: [],
        });
        expect(result.find((np) => np.identifier === "belief/other")!.belief).toBe(
          epistemic === "Mentioned" ? "mentioned" : "might",
        );
      }
    }
  });

  it.each([
    "Mentioned",
    "SelfReportedExplicit",
  ] as const)("%s contributes revisions only when it asserts a belief, for assertion and envelope targets", async (epistemic) => {
    for (const target of ["assertion", "envelope"]) {
      for (const original of ["SelfReportedExplicit", "Documented"] as const) {
        const value = await build([
          { id: "old", epistemic: original, assertion: assertion("old") },
          {
            id: "new",
            epistemic,
            assertion: assertion("new"),
            supersedes: target === "assertion" ? ["old"] : [],
          },
        ]);
        const old = value.nanopubs.find((np) => np.identifier === "belief/old")!;
        const newer = value.nanopubs.find((np) => np.identifier === "belief/new")!;
        if (target === "envelope") {
          const provenance = graph(value.dataset, newer.provenanceId);
          new RdfNode(newer.id, provenance).link(`${NS.prov}wasRevisionOf`, old.id);
          putGraph(value.dataset, newer.provenanceId, provenance);
        }
        const parsed = await parseNanopublications(await serializeNanopublications(value));
        for (const nanopubs of [parsed.nanopubs, [...parsed.nanopubs].reverse()]) {
          const result = classifyNanopublications({ ...parsed, nanopubs });
          expect(result.find((np) => np.id === old.id)).toMatchObject({
            belief: epistemic === "Mentioned" ? "definitely" : "past",
            replacedBy: epistemic === "Mentioned" ? [] : [newer.id],
          });
        }
      }
    }
  });

  it("tracks later revisions even when the old validity remains Current", async () => {
    const value = await build([
      { id: "old", epistemic: "SelfReportedExplicit", assertion: assertion("old") },
      {
        id: "new",
        epistemic: "SelfReportedExplicit",
        assertion: assertion("new"),
        supersedes: ["old"],
      },
      { id: "copy", epistemic: "Documented", assertion: assertion("new") },
    ]);
    value.nanopubs.push(value.nanopubs[0]!);
    const result = classifyNanopublications(value);
    const old = result.find((np) => np.identifier === "belief/old")!;
    expect(old.belief).toBe("past");
    expect(old.replacedBy).toEqual([result.find((np) => np.identifier === "belief/new")!.id]);
    expect(result.filter((np) => np.corroboration === 2)).toHaveLength(2);
    expect(result).toHaveLength(3);
    const newer = value.nanopubs.find((np) => np.identifier === "belief/new")!;
    newer.generatedAt = "2025-01-01T00:00:00Z";
    expect(
      classifyNanopublications(value).find((np) => np.identifier === "belief/old")!.belief,
    ).toBe("past");
  });

  it.each([
    "Historical",
    "Superseded",
    "invalidated",
  ] as const)("excludes %s claims from contradiction and revision inputs", async (state) => {
    const value = await build([
      {
        id: "old",
        epistemic: "SelfReportedExplicit",
        assertion: assertion("old"),
        contradicts: ["other"],
      },
      {
        id: "other",
        epistemic: "SelfReportedExplicit",
        validity: state === "invalidated" ? "Current" : state,
        assertion: assertion("other"),
        supersedes: ["old"],
        contradicts: ["old"],
      },
    ]);
    const other = value.nanopubs.find((np) => np.identifier === "belief/other")!;
    if (state === "invalidated") {
      const provenance = graph(value.dataset, other.provenanceId);
      new RdfNode(other.assertionId, provenance).text(
        `${NS.prov}invalidatedAtTime`,
        options.generatedAt,
        `${NS.xsd}dateTime`,
      );
      putGraph(value.dataset, other.provenanceId, provenance);
    }
    for (const nanopubs of [value.nanopubs, [...value.nanopubs].reverse()]) {
      const result = classifyNanopublications({ ...value, nanopubs });
      expect(result.find((np) => np.identifier === "belief/old")).toMatchObject({
        belief: "definitely",
        replacedBy: [],
      });
      expect(result.find((np) => np.id === other.id)!.belief).toBe("past");
    }
  });

  it("does not treat retired contradictions as unresolved", async () => {
    const value = await build([
      {
        id: "one",
        epistemic: "SelfReportedExplicit",
        assertion: assertion("one"),
        contradicts: ["two"],
      },
      {
        id: "two",
        epistemic: "SelfReportedExplicit",
        validity: "Retracted",
        assertion: assertion("two"),
        contradicts: ["one"],
      },
    ]);
    expect(
      classifyNanopublications(value).find((np) => np.identifier === "belief/one")!.belief,
    ).toBe("definitely");
  });

  it("honours cross-batch statement revisions when extraction order is reversed", async () => {
    const dated = (batch: string, statementAt: string, generatedAt: string) =>
      buildNanopublications(
        {
          batch_id: batch,
          worker: { agent_id: "https://example.org/client", agent_label: "Test" },
          sources: [{ id: "chat", kind: "document", url: `https://example.org/${batch}` }],
          claims: [
            {
              id: "claim",
              epistemic: "SelfReportedExplicit",
              assertion: assertion(batch),
              evidence: [{ source: "chat", timestamp: statementAt }],
            },
          ],
        },
        { ...options, generatedAt },
      );
    const old = await dated("old", "2026-10-24T12:00:00Z", "2026-10-26T12:00:00Z");
    const newer = await dated("new", "2026-10-25T12:00:00Z", "2026-10-25T13:00:00Z");
    const one = old.nanopubs[0]!;
    const two = newer.nanopubs[0]!;
    const dataset = new ReferenceStore([...old.dataset, ...newer.dataset]);
    const provenance = graph(dataset, two.provenanceId);
    new RdfNode(two.assertionId, provenance).link(`${NS.prov}wasRevisionOf`, one.assertionId);
    putGraph(dataset, two.provenanceId, provenance);
    const value = await parseNanopublications(
      await serializeNanopublications({ dataset, nanopubs: [one, two] }),
    );
    const result = classifyNanopublications(value);
    expect(result.find((np) => np.id === one.id)).toMatchObject({
      belief: "past",
      replacedBy: [two.id],
    });
    expect(result.find((np) => np.id === two.id)!.belief).toBe("definitely");
  });

  it("uses only the nanopub's own invalidation provenance", async () => {
    const value = await build([
      { id: "one", epistemic: "SelfReportedExplicit", assertion: assertion("shared") },
      { id: "two", epistemic: "SelfReportedExplicit", assertion: assertion("shared") },
    ]);
    const np = value.nanopubs[0]!;
    const provenance = graph(value.dataset, np.provenanceId);
    new RdfNode(np.assertionId, provenance).text(
      `${NS.prov}invalidatedAtTime`,
      options.generatedAt,
      `${NS.xsd}dateTime`,
    );
    putGraph(value.dataset, np.provenanceId, provenance);
    expect(
      classifyNanopublications(value)
        .map((item) => item.belief)
        .sort(),
    ).toEqual(["definitely", "past"]);
    expect(classifyNanopublications({ ...value, nanopubs: [] })).toEqual([]);
  });
});
