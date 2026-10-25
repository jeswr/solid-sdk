// AUTHORED-BY Codex GPT-6.1-Sol
// Ported Pod Docs regression tests.
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6 — alias setter regression coverage
import { LEGACY_NAMESPACES, NS as SUITE_NS } from "@jeswr/suite-vocab";
import { DataFactory, Parser, Store } from "n3";
import { assert, describe, expect, it } from "vitest";
import {
  buildDocument,
  DocumentDoc,
  parseDocument,
  RevisionDoc,
} from "../../src/apps/docs/lib/model/document.js";
import { serializeTurtle } from "../../src/apps/docs/lib/model/rdf-io.js";
import { TypeIndexDataset } from "../../src/apps/docs/lib/model/type-index.js";
import { DOCUMENT_CLASS, PD } from "../../src/apps/docs/lib/model/vocab.js";

const legacy = Object.keys(LEGACY_NAMESPACES).find(
  (key) => LEGACY_NAMESPACES[key] === SUITE_NS.POD_DOCS,
);
assert(legacy);
const URL = "https://pod.example/docs/one.ttl";

type AliasedValues = {
  body?: string | undefined;
  format?: string | undefined;
  currentRevision?: string | undefined;
};
const aliasSetters: {
  name: string;
  View: new (subject: string, dataset: Store, factory: typeof DataFactory) => AliasedValues;
  subject: string;
  property: keyof AliasedValues;
}[] = [
  { name: "document body", View: DocumentDoc, subject: `${URL}#it`, property: "body" },
  { name: "document format", View: DocumentDoc, subject: `${URL}#it`, property: "format" },
  {
    name: "document current revision",
    View: DocumentDoc,
    subject: `${URL}#it`,
    property: "currentRevision",
  },
  { name: "revision body", View: RevisionDoc, subject: `${URL}#rev-0`, property: "body" },
  { name: "revision format", View: RevisionDoc, subject: `${URL}#rev-0`, property: "format" },
];

describe.each(aliasSetters)("$name alias-aware setter", ({ View, subject, property }) => {
  const predicate = PD[property];
  const legacyPredicate = legacy + property;
  const oldObject = property === "currentRevision" ? `<${URL}#rev-old>` : '"old"';
  const newValue = property === "currentRevision" ? `${URL}#rev-new` : "new";

  function legacyDataset(): Store {
    return new Store(new Parser().parse(`<${subject}> <${legacyPredicate}> ${oldObject} .`));
  }

  it.each([false, true])("clears all values (mixed input: %s)", async (mixed) => {
    const dataset = legacyDataset();
    if (mixed) {
      dataset.addQuads(new Parser().parse(`<${subject}> <${predicate}> ${oldObject} .`));
    }
    const view = new View(subject, dataset, DataFactory);
    expect(view[property]).toBe(property === "currentRevision" ? `${URL}#rev-old` : "old");
    view[property] = undefined;
    expect(view[property]).toBeUndefined();
    expect(dataset.size).toBe(0);
    expect(await serializeTurtle(dataset)).not.toContain(legacyPredicate);
  });

  it("sets then clears a legacy value without resurrecting it", async () => {
    const dataset = legacyDataset();
    const view = new View(subject, dataset, DataFactory);
    view[property] = newValue;
    expect(view[property]).toBe(newValue);
    view[property] = undefined;
    expect(view[property]).toBeUndefined();
    expect(dataset.size).toBe(0);
    expect(await serializeTurtle(dataset)).not.toContain(legacyPredicate);
  });

  it.each([false, true])("writes only canonical predicates (mixed input: %s)", async (mixed) => {
    const dataset = legacyDataset();
    if (mixed) {
      dataset.addQuads(
        new Parser().parse(`
        <${subject}> <${predicate}> ${oldObject}, "another canonical value" ;
          <${legacyPredicate}> "another old value" .
      `),
      );
    }
    const view = new View(subject, dataset, DataFactory);
    view[property] = newValue;
    expect(view[property]).toBe(newValue);
    expect(dataset.size).toBe(1);
    const [quad] = [...dataset];
    expect(quad?.subject.value).toBe(subject);
    expect(quad?.predicate.value).toBe(predicate);
    expect(quad?.object.value).toBe(newValue);
    const output = await serializeTurtle(dataset);
    expect(output).toContain(predicate);
    expect(output).not.toContain(legacyPredicate);
  });

  it("preserves other subjects and properties when clearing aliases", () => {
    const dataset = legacyDataset();
    const otherPredicate = property === "body" ? PD.format : PD.body;
    dataset.addQuads(
      new Parser().parse(`
        <${URL}#other> <${legacyPredicate}> ${oldObject} .
        <${subject}> <${otherPredicate}> "keep" .
      `),
    );
    const preserved = [...dataset].filter(
      (quad) => quad.subject.value !== subject || quad.predicate.value !== legacyPredicate,
    );
    new View(subject, dataset, DataFactory)[property] = undefined;
    expect([...dataset]).toEqual(preserved);
  });
});

describe("legacy document vocabulary", () => {
  it.each([SUITE_NS.POD_DOCS, legacy])("reads body and revision history from %s", async (base) => {
    const dataset = new Store(
      new Parser().parse(`
      @prefix pd: <${base}> .
      @prefix prov: <${SUITE_NS.PROV}> .
      @prefix xsd: <${SUITE_NS.XSD}> .
      <${URL}#it> a "not a class" , pd:Document ; pd:body "hello" ; pd:format "text/markdown" ;
        pd:currentRevision <${URL}#rev-0> .
      <${URL}#rev-0> a prov:Entity ; pd:body "hello" ; pd:format "text/markdown" ;
        prov:generatedAtTime "2026-10-25T00:00:00Z"^^xsd:dateTime .
    `),
    );
    const document = parseDocument(URL, dataset);
    assert(document);
    expect(document.body).toBe("hello");
    expect(document.format).toBe("text/markdown");
    expect(document.revisions).toHaveLength(1);
    expect(document.revisions[0]?.body).toBe("hello");
    expect(document.revisions[0]?.format).toBe("text/markdown");
    const output = await serializeTurtle(
      buildDocument(URL, {
        ...document,
        priorRevisions: document.revisions,
      }),
    );
    expect(output).toContain(DOCUMENT_CLASS);
    expect(output).not.toContain(legacy);
  });

  it("prefers canonical values in a mixed document and accepts empty legacy literals", () => {
    const dataset = new Store(
      new Parser().parse(`
      <${URL}#it> <${legacy}body> "old" ; <${PD.body}> "new" .
      <${URL}#rev-0> <${legacy}body> "" .
    `),
    );
    expect(new DocumentDoc(`${URL}#it`, dataset, DataFactory).body).toBe("new");
    expect(new RevisionDoc(`${URL}#rev-0`, dataset, DataFactory).body).toBe("");
  });

  it.each([SUITE_NS.POD_DOCS, legacy])("locates Type Index registrations for %s", (base) => {
    const dataset = new Store(
      new Parser().parse(`
      @prefix solid: <${SUITE_NS.SOLID}> .
      [] a solid:TypeRegistration ; solid:forClass <${base}Document> ;
        solid:instanceContainer <https://pod.example/docs/> .
    `),
    );
    const index = new TypeIndexDataset(dataset, DataFactory);
    expect(index.locate(DOCUMENT_CLASS)[0]?.container).toBe("https://pod.example/docs/");
    expect(index.locate(`${legacy}Document`)).toHaveLength(1);
  });
});

it("adds a canonical registration alongside an old registration on ensure", async () => {
  const { mockFetch, turtleToStore } = await import("./helpers.js");
  const { ensureTypeRegistrations } = await import("../../src/apps/docs/lib/model/type-index.js");
  const webId = "https://pod.example/profile/card#me";
  const indexUrl = "https://pod.example/settings/privateTypeIndex.ttl";
  const container = "https://pod.example/docs/";
  const { fetch, calls } = mockFetch({
    [`GET ${webId}`]: { body: `<${webId}> <${SUITE_NS.SOLID}privateTypeIndex> <${indexUrl}> .` },
    [`GET ${indexUrl}`]: {
      body: `@prefix solid: <${SUITE_NS.SOLID}> .
      <#old> a solid:TypeRegistration ; solid:forClass <${legacy}Document> ; solid:instanceContainer <${container}> .`,
      etag: '"index"',
    },
    [`PUT ${indexUrl}`]: { status: 205 },
  });
  const result = await ensureTypeRegistrations({
    webId,
    podRoot: "https://pod.example/",
    registrations: [{ forClass: `${legacy}Document`, container }],
    fetchImpl: fetch,
  });
  expect(result.added).toBe(1);
  const put = calls.find((call) => call.method === "PUT");
  assert(put);
  const dataset = new TypeIndexDataset(turtleToStore(String(put.body), indexUrl), DataFactory);
  expect(
    dataset
      .all()
      .map((registration) => registration.forClass)
      .sort(),
  ).toEqual([DOCUMENT_CLASS, `${legacy}Document`].sort());
});
