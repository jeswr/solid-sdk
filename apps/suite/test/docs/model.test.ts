// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { NS as SUITE_NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { assert, describe, expect, it } from "vitest";
import {
  applyRevisionPolicy,
  buildDocument,
  DocumentDoc,
  parseDocument,
  type Revision,
  RevisionDoc,
} from "../../src/apps/docs/lib/model/index.js";
import { docContainerUrls, isDirectChild, toSlug } from "../../src/apps/docs/lib/model/layout.js";
import { serializeTurtle } from "../../src/apps/docs/lib/model/rdf-io.js";
import { turtleToStore } from "./helpers.js";

const URL_DOC = "https://pod.example/docs/plan.ttl";
const NOW = new Date("2026-10-25T12:00:00Z");
const snapshot = { body: "changed", format: "text/html", now: NOW };
function revision(index: number, minutes: number, label?: string): Revision {
  return {
    id: `${URL_DOC}#rev-${index}`,
    body: String(index),
    format: "text/html",
    generatedAt: new Date(NOW.getTime() - minutes * 60_000).toISOString(),
    label,
  };
}

describe("extended RDF model", () => {
  it("round-trips new terms through Turtle with an integer word count", async () => {
    const dataset = buildDocument(URL_DOC, {
      title: "Plan",
      body: "<p>Hello</p>",
      ...docContainerUrls(URL_DOC),
      wordCount: 1,
      wasDerivedFrom: "https://pod.example/docs/original.ttl#it",
      revisionLabel: "Draft",
      now: NOW,
    });
    const ttl = await serializeTurtle(dataset);
    const parsed = await parseRdf(ttl, "text/turtle", { baseIRI: URL_DOC });
    expect(parseDocument(URL_DOC, parsed)).toMatchObject({
      updateLog: docContainerUrls(URL_DOC).updateLog,
      assets: docContainerUrls(URL_DOC).assets,
      comments: docContainerUrls(URL_DOC).comments,
      wordCount: 1,
      wasDerivedFrom: "https://pod.example/docs/original.ttl#it",
      revisions: [{ label: "Draft" }],
    });
    const countTerm = [...parsed].find(
      (q) => q.predicate.value === `${SUITE_NS.SCHEMA}wordCount`,
    )?.object;
    assert(countTerm?.termType === "Literal");
    expect(countTerm.datatype.value).toBe(`${SUITE_NS.XSD}integer`);
  });
  it("accepts legacy container links and schema.org HTTP on read; clearing removes aliases", () => {
    const legacy = "https://w3id.org/jeswr/pod-docs#";
    const dataset = turtleToStore(
      `<#it> <${legacy}updateLog> <updates/> ; <${legacy}assets> <assets/> ;
      <${legacy}comments> <comments/> ; <http://schema.org/wordCount> 2 .`,
      URL_DOC,
    );
    const doc = new DocumentDoc(`${URL_DOC}#it`, dataset, DataFactory);
    expect(doc.updateLog).toBe("https://pod.example/docs/updates/");
    expect(doc.assets).toBe("https://pod.example/docs/assets/");
    expect(doc.comments).toBe("https://pod.example/docs/comments/");
    expect(doc.wordCount).toBe(2);
    doc.updateLog = undefined;
    doc.assets = undefined;
    doc.comments = undefined;
    doc.wordCount = undefined;
    expect(dataset.size).toBe(0);
    const rev = new RevisionDoc(`${URL_DOC}#r`, dataset, DataFactory);
    rev.label = "Named";
    expect(rev.label).toBe("Named");
    rev.label = undefined;
    expect(rev.label).toBeUndefined();
  });
  it.each([-1, 1.5, Infinity, NaN])("rejects invalid word counts %s", (value) => {
    expect(() => {
      new DocumentDoc(`${URL_DOC}#it`, new Store(), DataFactory).wordCount = value;
    }).toThrow(RangeError);
  });
  it("validates the title and named revision label", () => {
    expect(() => buildDocument(URL_DOC, { title: "a".repeat(201) })).toThrow(RangeError);
    expect(() => buildDocument(URL_DOC, { title: "a", revisionLabel: "  " })).toThrow(RangeError);
  });
});

describe("revision retention", () => {
  it("keeps snapshots current without adding auto revisions before 10 minutes", () => {
    const initial = revision(0, 9.999);
    const prior = [initial];
    const next = applyRevisionPolicy(URL_DOC, prior, snapshot);
    expect(next).toHaveLength(1);
    expect(prior).toEqual([initial]);
    expect(applyRevisionPolicy(URL_DOC, prior, { ...snapshot, label: "Named" })).toHaveLength(2);
    expect(applyRevisionPolicy(URL_DOC, [revision(0, 10)], snapshot)).toHaveLength(2);
    expect(
      applyRevisionPolicy(URL_DOC, [revision(0, 20)], { ...snapshot, body: "0" }),
    ).toHaveLength(1);
    const doc = parseDocument(
      URL_DOC,
      buildDocument(URL_DOC, { title: "T", body: "latest", priorRevisions: prior, now: NOW }),
    );
    expect(doc?.body).toBe("latest");
    expect(doc?.revisions[0]?.body).toBe("0");
  });
  it("prunes by generation time and relinks across named revisions", () => {
    const prior = Array.from({ length: 101 }, (_, n) => revision(n, n + 1));
    prior.splice(90, 0, revision(500, 500, "Preserve"));
    const result = applyRevisionPolicy(URL_DOC, prior, { ...snapshot, body: "0" });
    expect(result).toHaveLength(101);
    expect(result.some((r) => r.id.endsWith("rev-100"))).toBe(false);
    expect(result.find((r) => r.label)?.label).toBe("Preserve");
    expect(result.at(-1)?.wasRevisionOf).toBeUndefined();
    expect(prior.at(-1)?.wasRevisionOf).toBeUndefined();
  });
  it("normalizes duplicate IDs and hostile links without mutating input", () => {
    const r = revision(0, 1);
    r.wasRevisionOf = r.id;
    const result = applyRevisionPolicy(URL_DOC, [r, r], { ...snapshot, body: r.body });
    expect(result).toHaveLength(1);
    expect(result[0]?.wasRevisionOf).toBeUndefined();
    expect(r.wasRevisionOf).toBe(r.id);
  });
  it("property: arbitrary saves preserve named versions and an acyclic, bounded chain", () => {
    // Deterministic generated sequences need no extra property-testing dependency.
    for (let seed = 1; seed <= 12; seed++) {
      let random = seed;
      let revisions: Revision[] = [];
      const names: string[] = [];
      let clock = 0;
      for (let save = 0; save < 400; save++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        clock += random % 1_200_000;
        const label = random % 13 === 0 ? `Named ${save}` : undefined;
        if (label) names.push(label);
        revisions = applyRevisionPolicy(URL_DOC, revisions, {
          ...snapshot,
          now: new Date(clock),
          body: String(random % 5),
          label,
        });
        const ids = new Set(revisions.map((r) => r.id));
        expect(ids.size).toBe(revisions.length);
        expect(revisions.filter((r) => r.label === undefined).length).toBeLessThanOrEqual(100);
        expect(revisions.filter((r) => r.label !== undefined).map((r) => r.label)).toEqual(
          [...names].reverse(),
        );
        revisions.forEach((r, i) => {
          expect(r.wasRevisionOf).toBe(revisions[i + 1]?.id);
        });
      }
      assert(revisions.length > 100);
    }
  });
});

describe("layout and validation", () => {
  it("derives per-document URLs", () => {
    expect(docContainerUrls("plan", "https://pod.example/docs/")).toEqual(
      docContainerUrls(URL_DOC),
    );
    expect(() => docContainerUrls("../escape", "https://pod.example/docs/")).toThrow(TypeError);
    expect(() => docContainerUrls("plan", "https://pod.example/docs")).toThrow(TypeError);
    expect(docContainerUrls(URL_DOC)).toEqual({
      resource: URL_DOC,
      container: "https://pod.example/docs/plan/",
      updateLog: "https://pod.example/docs/plan/updates/",
      assets: "https://pod.example/docs/plan/assets/",
      comments: "https://pod.example/docs/plan/comments/",
    });
    expect(docContainerUrls("https://pod.example/pod-docs/plan.ttl").assets).toContain(
      "/pod-docs/",
    );
  });
  it.each([
    "file:///a.ttl",
    "https://x/a",
    "https://u:p@x/a.ttl",
    "https://x/a.ttl?q=1",
    "https://x/a.ttl#it",
    "https://x/a%2fb.ttl",
  ])("rejects invalid resource %s", (url) => {
    expect(() => docContainerUrls(url)).toThrow(TypeError);
  });
  it("scope guard rejects unsafe children", () => {
    const parent = "https://pod.example/docs/";
    for (const url of [
      "nonsense",
      parent,
      `${parent}nested/a`,
      `${parent}a%2fb`,
      `${parent}a%5cb`,
      `${parent}a?b`,
      `${parent}a#b`,
      "https://evil.example/docs/a",
      "https://u:p@pod.example/docs/a",
      "ftp://pod.example/docs/a",
    ]) {
      expect(isDirectChild(url, parent), url).toBe(false);
    }
    expect(isDirectChild(URL_DOC, parent)).toBe(true);
  });
  it("normalizes and bounds readable slugs", () => {
    expect(toSlug(undefined)).toBe("");
    expect(toSlug("")).toBe("");
    expect(toSlug("!!!")).toBe("");
    expect(toSlug("Café: Hello, World!")).toBe("cafe-hello-world");
    expect(toSlug(`${"a".repeat(47)}--- b`)).toBe("a".repeat(47));
  });
});
