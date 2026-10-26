// AUTHORED-BY Codex GPT-6.1-Sol
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee these entries. */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildNanopublications,
  type Claim,
  classifyNanopublications,
  createFactAssertion,
  EPISTEMIC_STATUSES,
  parseNanopublications,
  VALIDITY_STATUSES,
} from "../src/index.js";
import { graph, NS, putGraph, RdfNode } from "../src/rdf.js";
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
    ).toBe("definitely");
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

  it("orders revisions at microsecond precision across timezone offsets", async () => {
    const value = await build([
      { id: "one", epistemic: "SelfReportedExplicit", assertion: assertion("one") },
      {
        id: "two",
        epistemic: "SelfReportedExplicit",
        assertion: assertion("two"),
        supersedes: ["one"],
      },
    ]);
    const one = value.nanopubs.find((np) => np.identifier === "belief/one")!;
    const two = value.nanopubs.find((np) => np.identifier === "belief/two")!;
    one.generatedAt = "2026-10-25T12:00:00.000500+00:00";
    two.generatedAt = "2026-10-25T13:00:00.000400+01:00";
    expect(classifyNanopublications(value).find((np) => np.id === one.id)!.belief).toBe(
      "definitely",
    );
    two.generatedAt = "2026-10-25T13:00:00.000600+01:00";
    expect(classifyNanopublications(value).find((np) => np.id === one.id)!.belief).toBe("past");
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
