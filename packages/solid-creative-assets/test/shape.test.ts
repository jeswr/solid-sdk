// AUTHORED-BY Claude Sonnet 5.5
import { readFileSync } from "node:fs";
import { parseRdf } from "@jeswr/fetch-rdf";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { afterAll, describe, expect, it } from "vitest";
import { buildAssetDocument } from "../src/assets.js";
import { buildCollection, buildProjectDocument, documentToTurtle } from "../src/documents.js";
import { DOC, fullImage, mesh, splat, video } from "./fixtures.js";

const engine = createRdfEngine();
afterAll(() => engine.dispose());

const shapes = readFileSync(new URL("../creative-assets.shacl.ttl", import.meta.url), "utf8");
const generatedShapes = readFileSync(
  new URL("../src/generated/shapes.ttl", import.meta.url),
  "utf8",
);
const PREFIXES = `@prefix schema: <https://schema.org/> . @prefix prov: <http://www.w3.org/ns/prov#> .
  @prefix hschema: <http://schema.org/> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;

async function conforms(body: string, profile = shapes): Promise<boolean> {
  const data = await parseRdf(`${PREFIXES}\n${body}`, "text/turtle", { baseIRI: DOC });
  return (await engine.validate(data, profile)).conforms;
}
async function builtConforms(store: Parameters<typeof documentToTurtle>[0], profile = shapes) {
  const data = await parseRdf(await documentToTurtle(store), "text/turtle", { baseIRI: DOC });
  return (await engine.validate(data, profile)).conforms;
}

describe("every written shape validates against the SHACL profile", () => {
  for (const [name, description] of Object.entries({ fullImage, video, mesh, splat })) {
    it(`${name}: the written document conforms to the profile and to the generated shapes`, async () => {
      const store = buildAssetDocument(DOC, description);
      expect(await builtConforms(store)).toBe(true);
      expect(await builtConforms(store, generatedShapes)).toBe(true);
    });
  }

  it("a project document and a collection conform", async () => {
    const project = buildProjectDocument(DOC, {
      name: "Scene",
      contentUrl: "https://pod.example/scene.json",
      schemaVersion: "1",
      additionalType: "scene_3d",
      hasPart: ["https://pod.example/a#it"],
      dateCreated: new Date("2026-01-01T00:00:00Z"),
      dateModified: new Date("2026-01-02T00:00:00Z"),
    });
    expect(await builtConforms(project)).toBe(true);
    expect(
      await builtConforms(
        buildCollection(DOC, { name: "c", hasPart: ["https://pod.example/a#it"] }),
      ),
    ).toBe(true);
  });
});

describe("the profile rejects what the model would not write", () => {
  const good = `<${DOC}#it> a schema:ImageObject ; schema:contentUrl <https://pod.example/f.png> ;`;
  it("accepts the baseline", async () => {
    expect(await conforms(`${good} schema:width 10 .`)).toBe(true);
  });
  it("rejects a missing contentUrl, a literal contentUrl and a non-http(s) contentUrl", async () => {
    expect(await conforms(`<${DOC}#it> a schema:ImageObject .`)).toBe(false);
    expect(
      await conforms(
        `<${DOC}#it> a schema:ImageObject ; schema:contentUrl "https://pod.example/f.png" .`,
      ),
    ).toBe(false);
    expect(
      await conforms(
        `<${DOC}#it> a schema:ImageObject ; schema:contentUrl <javascript:alert(1)> .`,
      ),
    ).toBe(false);
  });
  it("rejects a wrongly typed width, and a date where a dateTime is required", async () => {
    expect(await conforms(`${good} schema:width "wide" .`)).toBe(false);
    expect(await conforms(`${good} schema:height 5.5 .`)).toBe(false);
    // The wrapper library once wrote xsd:date lexically as a dateTime; the shape catches the datatype.
    expect(await conforms(`${good} schema:dateCreated "2026-06-15"^^xsd:date .`)).toBe(false);
    expect(
      await conforms(`${good} schema:dateCreated "2026-06-15T09:41:07Z"^^xsd:dateTime .`),
    ).toBe(true);
  });
  it("rejects two names, a non-string keyword and an IRI creator written as a literal", async () => {
    expect(await conforms(`${good} schema:name "a", "b" .`)).toBe(false);
    expect(await conforms(`${good} schema:keywords 7 .`)).toBe(false);
    expect(await conforms(`${good} schema:creator "alice" .`)).toBe(false);
  });
  it("requires a setting's propertyID and value to be non-blank", async () => {
    const setting = `<${DOC}#setting-1> a schema:PropertyValue ;`;
    expect(await conforms(`${setting} schema:propertyID "seed" ; schema:value "1" .`)).toBe(true);
    expect(await conforms(`${setting} schema:propertyID "seed" .`)).toBe(false);
    expect(await conforms(`${setting} schema:propertyID " " ; schema:value "1" .`)).toBe(false);
    expect(await conforms(`${setting} schema:propertyID "seed" ; schema:value 42 .`)).toBe(false);
  });
  it("types a run's timestamps", async () => {
    const run = `<${DOC}#run> a prov:Activity ;`;
    expect(await conforms(`${run} prov:startedAtTime "2026-06-15T09:40:00Z"^^xsd:dateTime .`)).toBe(
      true,
    );
    expect(await conforms(`${run} prov:startedAtTime "yesterday" .`)).toBe(false);
  });
  it("applies the same constraints to a node typed with the legacy http class", async () => {
    expect(
      await conforms(
        `<${DOC}#it> a hschema:ImageObject ; schema:contentUrl <https://pod.example/f.png> .`,
      ),
    ).toBe(true);
    expect(await conforms(`<${DOC}#it> a hschema:ImageObject .`)).toBe(false);
  });
});
