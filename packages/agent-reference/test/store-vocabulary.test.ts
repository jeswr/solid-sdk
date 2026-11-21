// AUTHORED-BY Codex GPT-6.2 Sol
import { parseRdfSync } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { expect, it } from "vitest";
import { digestBytes } from "../src/core/canonical.js";
import { readDocument } from "../src/wire/document.js";
import {
  STORE_CONTEXT,
  STORE_CONTEXT_SHA256,
  storeDocumentLoader,
} from "../src/wire/store-contexts.js";

const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const rdfs = "http://www.w3.org/2000/01/rdf-schema#";
const sh = "http://www.w3.org/ns/shacl#";
const read = (file: string) => readFileSync(new URL("../vocab/" + file, import.meta.url), "utf8");

it("defines the store classes, properties and context terms", () => {
  const ontology = parseRdfSync(read("answerable-stores.ttl"));
  const existing = parseRdfSync(read("answerable.ttl"));
  const shapes = parseRdfSync(read("answerable-stores.shacl.ttl"));
  expect(ontology.size).toBeGreaterThan(0);
  const reused = new Set([
    "http://www.w3.org/ns/prov#generatedAtTime",
    "http://www.w3.org/ns/prov#wasAttributedTo",
    "http://www.w3.org/ns/odrl/2/action",
    "http://www.w3.org/ns/odrl/2/hasPolicy",
    "http://www.w3.org/2000/01/rdf-schema#label",
    "https://w3id.org/security#controller",
    "https://www.w3.org/2018/credentials#validUntil",
    "http://www.w3.org/ns/prov#wasDerivedFrom",
    "https://schema.org/ItemList",
    "https://schema.org/PropertyValue",
    "https://schema.org/itemListElement",
    "https://schema.org/name",
    "https://schema.org/position",
    "https://schema.org/propertyID",
    "https://schema.org/value",
  ]);
  const defined = (iri: string) =>
    reused.has(iri) ||
    ontology.countQuads(iri, null, null, null) + existing.countQuads(iri, null, null, null) > 0;
  for (const term of ontology.getSubjects(rdf + "type", null, null)) {
    expect(ontology.countQuads(term, rdfs + "label", null, null), term.value).toBe(1);
    expect(ontology.countQuads(term, rdfs + "comment", null, null), term.value).toBe(1);
    if (ontology.countQuads(term, rdf + "type", rdf + "Property", null)) {
      expect(ontology.countQuads(term, rdfs + "domain", null, null), term.value).toBe(1);
      expect(ontology.countQuads(term, rdfs + "range", null, null), term.value).toBe(1);
    }
    if (ontology.countQuads(term, rdf + "type", "http://www.w3.org/2002/07/owl#Class", null))
      expect(shapes.countQuads(null, sh + "targetClass", term, null), term.value).toBe(1);
  }
  for (const path of shapes.getObjects(null, sh + "path", null))
    expect(defined(path.value), path.value).toBe(true);
  const context = JSON.parse(read("context/store-v1.jsonld"))["@context"];
  expect(context).toMatchObject({ "@version": 1.1, "@protected": true });
  expect(context).not.toHaveProperty("@base");
  expect(context).not.toHaveProperty("@vocab");
  for (const [key, value] of Object.entries(context)) {
    const iri = typeof value === "string" ? value : (value as { "@id"?: string })?.["@id"];
    if (iri && !iri.startsWith("@")) expect(defined(iri), key).toBe(true);
  }
});

it("pins the display context separately and refuses it on the wire", async () => {
  const bytes = read("context/store-v1.jsonld");
  expect(digestBytes(bytes)).toBe("sha-256:" + STORE_CONTEXT_SHA256);
  expect(await storeDocumentLoader.load(STORE_CONTEXT)).toEqual(JSON.parse(bytes));
  await expect(storeDocumentLoader.load("https://unbundled.example/")).rejects.toThrow(
    "context-not-accepted",
  );
  await expect(
    readDocument(
      JSON.stringify({ "@context": STORE_CONTEXT, "@id": "urn:message" }),
      "application/ld+json",
    ),
  ).resolves.toMatchObject({ ok: false, detail: "context-not-accepted" });
});
