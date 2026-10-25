// AUTHORED-BY Codex GPT-6.1-Sol
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LEGACY_NAMESPACES, NS as SUITE_NS } from "@jeswr/suite-vocab";
import { DataFactory, Parser, Store } from "n3";
import { assert, describe, expect, it } from "vitest";
import { buildDocument, DocumentDoc, parseDocument, RevisionDoc } from "./document.js";
import { serializeTurtle } from "./rdf-io.js";
import { TypeIndexDataset } from "./type-index.js";
import { DOCUMENT_CLASS, PD } from "./vocab.js";

const legacy = Object.keys(LEGACY_NAMESPACES).find(
  (key) => LEGACY_NAMESPACES[key] === SUITE_NS.POD_DOCS,
);
assert(legacy);
const URL = "https://pod.example/docs/one.ttl";

describe("legacy document vocabulary", () => {
  it.each([SUITE_NS.POD_DOCS, legacy])("reads body and revision history from %s", async (base) => {
    const dataset = new Store(
      new Parser().parse(`
      @prefix pd: <${base}> .
      @prefix prov: <${SUITE_NS.PROV}> .
      @prefix xsd: <${SUITE_NS.XSD}> .
      <${URL}#it> a pd:Document ; pd:body "hello" ; pd:format "text/markdown" ;
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

it("keeps legacy literals out of all three app source trees", () => {
  for (const app of ["pod-docs", "pod-drive", "pod-health"]) {
    const root = resolve(import.meta.dirname, "../../", app, "src");
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const source = readFileSync(resolve(entry.parentPath, entry.name), "utf8");
      for (const forbidden of ["TBD" + ".example", "w3id.org" + "/jeswr"]) {
        expect(source, `${app}/${entry.name}`).not.toContain(forbidden);
      }
    }
  }
});

it("adds a canonical registration alongside an old registration on ensure", async () => {
  const { mockFetch, turtleToStore } = await import("./test-helpers.js");
  const { ensureTypeRegistrations } = await import("./type-index.js");
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
