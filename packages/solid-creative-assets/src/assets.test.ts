// AUTHORED-BY Claude Sonnet 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { ALICE, DOC, fullImage, graphOf, mesh, splat, video } from "../test/fixtures.js";
import {
  type AssetDescription,
  buildAssetDocument,
  documentUrl,
  nodeIri,
  parseAssetDocument,
} from "./assets.js";
import {
  buildCollection,
  buildProjectDocument,
  documentToTurtle,
  parseAssetDocumentTtl,
  parseCollection,
  parseCollectionTtl,
  parseProjectDocument,
  parseProjectDocumentTtl,
  serializeAssetDocument,
  serializeCollection,
  serializeProjectDocument,
} from "./documents.js";
import { CLASSES, RDF_TYPE, SCHEMA, schema } from "./vocab.js";

const { namedNode } = DataFactory;
const XSD = "http://www.w3.org/2001/XMLSchema#";
const it0 = nodeIri(DOC, "it");

/** Parse Turtle text the way a pod client would. */
const ttl = (body: string): Promise<DatasetCore> =>
  parseRdf(
    `@prefix schema: <https://schema.org/> . @prefix prov: <http://www.w3.org/ns/prov#> .
     @prefix xsd: <${XSD}> . @prefix hschema: <http://schema.org/> .\n${body}`,
    "text/turtle",
    { baseIRI: DOC },
  );

describe("asset description documents round trip", () => {
  it("round-trips a fully described image through the store", () => {
    expect(parseAssetDocument(DOC, buildAssetDocument(DOC, fullImage))).toEqual(fullImage);
  });

  it("round-trips a video with its duration and a minimal generation", () => {
    expect(parseAssetDocument(DOC, buildAssetDocument(DOC, video))).toEqual(video);
  });

  it("round-trips a mesh and a gaussian splat, told apart by encodingFormat", () => {
    const parsedMesh = parseAssetDocument(DOC, buildAssetDocument(DOC, mesh));
    const parsedSplat = parseAssetDocument(DOC, buildAssetDocument(DOC, splat));
    expect(parsedMesh).toEqual(mesh);
    expect(parsedSplat).toEqual(splat);
    expect(parsedMesh?.kind).toBe("model3d");
    expect(parsedSplat?.asset.encodingFormat).toBe("application/x-gaussian-splat");
  });

  it("round-trips the smallest asset (contentUrl only)", () => {
    const minimal: AssetDescription = {
      kind: "image",
      asset: { contentUrl: "https://pod.example/f.png" },
    };
    expect(parseAssetDocument(DOC, buildAssetDocument(DOC, minimal))).toEqual(minimal);
  });

  it("trims and sorts keywords and drops blanks", () => {
    const store = buildAssetDocument(DOC, {
      kind: "image",
      asset: { contentUrl: "https://pod.example/f.png", keywords: [" b ", "a", "  "] },
    });
    expect(parseAssetDocument(DOC, store)?.asset).toMatchObject({ keywords: ["a", "b"] });
  });

  it("writes one typed node per concept at hash IRIs, never blank nodes", () => {
    const store = buildAssetDocument(DOC, fullImage);
    const types = new Map(
      [...store.match(null, namedNode(RDF_TYPE), null)].map((q) => [
        q.subject.value,
        q.object.value,
      ]),
    );
    expect(Object.fromEntries(types)).toEqual({
      [`${DOC}#it`]: CLASSES.image,
      [`${DOC}#thumbnail`]: CLASSES.image,
      [`${DOC}#prompt`]: CLASSES.creativeWork,
      [`${DOC}#model`]: CLASSES.aiModel,
      [`${DOC}#setting-1`]: CLASSES.setting,
      [`${DOC}#setting-2`]: CLASSES.setting,
      [`${DOC}#run`]: CLASSES.run,
    });
    expect([...store].some((q) => q.subject.termType === "BlankNode")).toBe(false);
    expect([...store].some((q) => q.object.termType === "BlankNode")).toBe(false);
  });

  it("keeps a 64-bit seed exact because settings are strings", () => {
    const parsed = parseAssetDocument(DOC, buildAssetDocument(DOC, fullImage));
    expect(parsed?.generation?.settings?.[0]).toEqual({
      propertyID: "seed",
      value: "18446744073709551615",
    });
  });

  it("writes width and height as xsd:integer and dates as xsd:dateTime", () => {
    const store = buildAssetDocument(DOC, fullImage);
    const object = (p: string) =>
      [...store.match(namedNode(it0), namedNode(schema(p)), null)][0]?.object;
    const dim = object("width");
    expect(dim?.termType === "Literal" && dim.datatype.value).toBe(`${XSD}integer`);
    const date = object("dateCreated");
    expect(date?.termType === "Literal" && date.datatype.value).toBe(`${XSD}dateTime`);
  });

  it("orders more than nine settings numerically", () => {
    const settings = Array.from({ length: 11 }, (_, i) => ({ propertyID: `p${i}`, value: `${i}` }));
    const store = buildAssetDocument(DOC, { ...mesh, generation: { settings } });
    expect(parseAssetDocument(DOC, store)?.generation?.settings).toEqual(settings);
  });
});

describe("Turtle documents", () => {
  it("serialises to Turtle and parses back to the same description", async () => {
    const text = await serializeAssetDocument(DOC, fullImage);
    expect(await parseAssetDocumentTtl(DOC, text)).toEqual(fullImage);
  });

  it("re-parsed Turtle is the same graph as the built store, not the same bytes", async () => {
    const store = buildAssetDocument(DOC, fullImage);
    const reparsed = await parseRdf(await documentToTurtle(store), "text/turtle", { baseIRI: DOC });
    expect(graphOf(reparsed)).toEqual(graphOf(store));
  });

  it("reads JSON-LD the way a server may re-serialise it", async () => {
    const jsonld = JSON.stringify({
      "@context": { "@vocab": SCHEMA, prov: "http://www.w3.org/ns/prov#", "@base": DOC },
      "@id": "#it",
      "@type": "ImageObject",
      contentUrl: { "@id": "https://pod.example/f.png" },
      width: 640,
      keywords: ["b", "a"],
      "prov:wasGeneratedBy": { "@id": "#run" },
      "@graph": [],
    });
    const parsed = await parseAssetDocumentTtl(DOC, jsonld, "application/ld+json");
    expect(parsed).toEqual({
      kind: "image",
      asset: { contentUrl: "https://pod.example/f.png", width: 640, keywords: ["a", "b"] },
    });
  });

  it("defaults an absent content type to Turtle", async () => {
    const text = await serializeAssetDocument(DOC, mesh);
    expect(await parseAssetDocumentTtl(DOC, text, null)).toEqual(mesh);
  });
});

describe("project documents and collections", () => {
  const project = {
    name: "Fox scene",
    contentUrl: "https://pod.example/creative/files/scene.json",
    encodingFormat: "application/json",
    schemaVersion: "3",
    additionalType: "scene_3d",
    hasPart: [`${DOC}#it`, "https://pod.example/creative/assets/other#it"],
    dateCreated: new Date("2026-06-15T09:00:00.000Z"),
    dateModified: new Date("2026-06-16T10:00:00.000Z"),
    creator: ALICE,
  };

  it("round-trips a project document", async () => {
    expect(parseProjectDocument(DOC, buildProjectDocument(DOC, project))).toEqual(project);
    const text = await serializeProjectDocument(DOC, project);
    expect(await parseProjectDocumentTtl(DOC, text)).toEqual(project);
  });

  it("refuses a project without a usable contentUrl on write and on read", async () => {
    expect(() => buildProjectDocument(DOC, { name: "no file" })).toThrow(TypeError);
    expect(() => buildProjectDocument(DOC, { contentUrl: "javascript:alert(1)" })).toThrow(
      TypeError,
    );
    const noFile = await ttl(`<${it0}> a schema:CreativeWork ; schema:name "x" .`);
    expect(parseProjectDocument(DOC, noFile)).toBeUndefined();
  });

  it("does not read a prompt node's text as a project", async () => {
    const data = await ttl(
      `<${it0}> a schema:CreativeWork ; schema:contentUrl <https://pod.example/p.json> ; schema:text "stray" .`,
    );
    expect(parseProjectDocument(DOC, data)).toEqual({ contentUrl: "https://pod.example/p.json" });
  });

  it("round-trips a collection", async () => {
    const collection = {
      name: "Foxes",
      hasPart: [`${DOC}#it`],
      dateCreated: new Date("2026-06-15T09:00:00.000Z"),
    };
    expect(parseCollection(DOC, buildCollection(DOC, collection))).toEqual(collection);
    expect(await parseCollectionTtl(DOC, await serializeCollection(DOC, collection))).toEqual(
      collection,
    );
  });

  it("does not read an asset as a project or a collection, or the reverse", () => {
    const asset = buildAssetDocument(DOC, mesh);
    expect(parseProjectDocument(DOC, asset)).toBeUndefined();
    expect(parseCollection(DOC, asset)).toBeUndefined();
    expect(parseAssetDocument(DOC, buildCollection(DOC, { name: "c" }))).toBeUndefined();
  });
});

describe("write-time fail-closed checks", () => {
  const image = (asset: object): AssetDescription =>
    ({
      kind: "image",
      asset: { contentUrl: "https://pod.example/f.png", ...asset },
    }) as AssetDescription;

  it("refuses an asset whose contentUrl is missing, relative or not http(s)", () => {
    for (const contentUrl of ["", "relative/f.png", "javascript:alert(1)", "data:text/plain,x"]) {
      expect(() => buildAssetDocument(DOC, image({ contentUrl }))).toThrow(TypeError);
    }
  });

  it("refuses a thumbnail, setting or prompt that lacks its required value", () => {
    expect(() => buildAssetDocument(DOC, { ...image({}), thumbnail: { contentUrl: "x" } })).toThrow(
      TypeError,
    );
    for (const settings of [
      [{ propertyID: "", value: "1" }],
      [{ propertyID: "seed", value: undefined as never }],
    ]) {
      expect(() => buildAssetDocument(DOC, { ...image({}), generation: { settings } })).toThrow(
        TypeError,
      );
    }
    expect(() => buildAssetDocument(DOC, { ...image({}), generation: { prompt: "  " } })).toThrow(
      TypeError,
    );
  });

  it("rejects a document URL that is relative, unsafe or carries a fragment", () => {
    for (const url of ["relative", "https://pod.example/a#frag", "https://pod.example/a b", ""]) {
      expect(() => documentUrl(url)).toThrow(TypeError);
      expect(() => buildAssetDocument(url, mesh)).toThrow(TypeError);
      expect(() => parseAssetDocument(url, new Store())).toThrow(TypeError);
    }
  });
});

describe("malformed pod data is rejected or skipped", () => {
  it("rejects an asset with no contentUrl", async () => {
    expect(
      parseAssetDocument(DOC, await ttl(`<${it0}> a schema:ImageObject ; schema:name "x" .`)),
    ).toBeUndefined();
  });

  it("rejects a contentUrl that is a literal, or an IRI that is not http(s)", async () => {
    for (const object of [
      '"https://pod.example/f.png"',
      "<javascript:alert(1)>",
      "<file:///etc/passwd>",
    ]) {
      const data = await ttl(`<${it0}> a schema:ImageObject ; schema:contentUrl ${object} .`);
      expect(parseAssetDocument(DOC, data)).toBeUndefined();
    }
  });

  it("skips an optional field of the wrong datatype and keeps the asset", async () => {
    const data = await ttl(`<${it0}> a schema:ImageObject ;
      schema:contentUrl <https://pod.example/f.png> ;
      schema:width "wide" ; schema:height "5.5"^^xsd:decimal ;
      schema:dateCreated "2026-06-15"^^xsd:date ; schema:name 42 ;
      schema:creator "alice" ; schema:thumbnail <javascript:x> .`);
    expect(parseAssetDocument(DOC, data)).toEqual({
      kind: "image",
      asset: { contentUrl: "https://pod.example/f.png" },
    });
  });

  it("drops an ambiguous singleton and keeps the rest", async () => {
    const data = await ttl(`<${it0}> a schema:ImageObject ;
      schema:contentUrl <https://pod.example/f.png> ; schema:name "one", "two" ; schema:width 10 .`);
    expect(parseAssetDocument(DOC, data)).toEqual({
      kind: "image",
      asset: { contentUrl: "https://pod.example/f.png", width: 10 },
    });
  });

  it("filters non-literal keywords and non-http(s) IRIs out of sets", async () => {
    const data = await ttl(`<${it0}> a schema:ImageObject ;
      schema:contentUrl <https://pod.example/f.png> ; schema:keywords "ok", <https://x.example/k>, 7 ;
      prov:wasDerivedFrom <https://pod.example/src#it>, <javascript:x>, "text" .`);
    expect(parseAssetDocument(DOC, data)?.asset).toEqual({
      contentUrl: "https://pod.example/f.png",
      keywords: ["ok"],
      wasDerivedFrom: ["https://pod.example/src#it"],
    });
  });

  it("does not follow links to nodes outside the document or without a node", async () => {
    const external =
      await ttl(`<${it0}> a schema:ImageObject ; schema:contentUrl <https://pod.example/f.png> ;
      schema:thumbnail <https://other.example/t#it> ; prov:wasGeneratedBy <https://other.example/r#run> .`);
    expect(parseAssetDocument(DOC, external)).toEqual({
      kind: "image",
      asset: { contentUrl: "https://pod.example/f.png" },
    });
    const dangling =
      await ttl(`<${it0}> a schema:ImageObject ; schema:contentUrl <https://pod.example/f.png> ;
      schema:thumbnail <${DOC}#thumbnail> ; prov:wasGeneratedBy <${DOC}#run> .`);
    expect(parseAssetDocument(DOC, dangling)?.thumbnail).toBeUndefined();
    expect(parseAssetDocument(DOC, dangling)?.generation).toBeUndefined();
  });

  it("skips a setting without a value and a non-http(s) run input", async () => {
    const data =
      await ttl(`<${it0}> a schema:3DModel ; schema:contentUrl <https://pod.example/m.glb> ;
        prov:wasGeneratedBy <${DOC}#run> .
      <${DOC}#run> a prov:Activity ; prov:used <${DOC}#setting-1>, <${DOC}#setting-2>, <javascript:x> .
      <${DOC}#setting-1> a schema:PropertyValue ; schema:propertyID "seed" .
      <${DOC}#setting-2> a schema:PropertyValue ; schema:propertyID "steps" ; schema:value "30" .`);
    expect(parseAssetDocument(DOC, data)?.generation).toEqual({
      settings: [{ propertyID: "steps", value: "30" }],
    });
  });

  it("ignores a node of the wrong type", async () => {
    const data =
      await ttl(`<${it0}> a schema:ImageObject ; schema:contentUrl <https://pod.example/f.png> ;
        schema:thumbnail <${DOC}#thumbnail> .
      <${DOC}#thumbnail> a schema:Person ; schema:contentUrl <https://pod.example/t.png> .`);
    expect(parseAssetDocument(DOC, data)?.thumbnail).toBeUndefined();
  });
});

describe("legacy http://schema.org/ read aliases", () => {
  it("reads every class written in the legacy scheme to the same description", async () => {
    const canonical = await serializeAssetDocument(DOC, fullImage);
    const legacy = canonical
      .replaceAll("schema:ImageObject", "hschema:ImageObject")
      .replaceAll("schema:CreativeWork", "hschema:CreativeWork")
      .replaceAll("schema:SoftwareApplication", "hschema:SoftwareApplication")
      .replaceAll("schema:PropertyValue", "hschema:PropertyValue")
      .replace("@prefix rdf:", "@prefix hschema: <http://schema.org/>.\n@prefix rdf:");
    const data = await parseRdf(legacy, "text/turtle", { baseIRI: DOC });
    expect(graphOf(data)).not.toEqual(
      graphOf(await parseRdf(canonical, "text/turtle", { baseIRI: DOC })),
    );
    expect(parseAssetDocument(DOC, data)).toEqual(fullImage);
  });

  it("reads legacy video, 3D model, collection and project classes", async () => {
    const cases: [string, (d: DatasetCore) => unknown][] = [
      ["hschema:VideoObject", (d) => parseAssetDocument(DOC, d)?.kind],
      ["hschema:3DModel", (d) => parseAssetDocument(DOC, d)?.kind],
      ["hschema:CreativeWork", (d) => parseProjectDocument(DOC, d)?.contentUrl],
      ["hschema:Collection", (d) => parseCollection(DOC, d)?.name],
    ];
    const expected = ["video", "model3d", "https://pod.example/x", "c"];
    for (const [i, [type, read]] of cases.entries()) {
      const data = await ttl(
        `<${it0}> a ${type} ; schema:contentUrl <https://pod.example/x> ; schema:name "c" .`,
      );
      expect(read(data), type).toBe(expected[i]);
    }
  });

  it("writes only the canonical https scheme, replacing a legacy type on write", async () => {
    const data = await ttl(
      `<${it0}> a hschema:ImageObject ; schema:contentUrl <https://pod.example/f.png> .`,
    );
    const text = await documentToTurtle(new Store([...data]));
    expect(text).toContain("schema:ImageObject");
    expect(text).not.toContain("http://schema.org/");
  });

  it("does NOT read legacy predicates (generator gap: one aliased owner per predicate)", async () => {
    const data = await ttl(
      `<${it0}> a hschema:ImageObject ; hschema:contentUrl <https://pod.example/f.png> ; hschema:name "x" .`,
    );
    expect(parseAssetDocument(DOC, data)).toBeUndefined();
  });

  it("builds from a parsed legacy document without leaving legacy types", async () => {
    const data = await ttl(
      `<${it0}> a hschema:VideoObject ; schema:contentUrl <https://pod.example/v.mp4> .`,
    );
    const parsed = parseAssetDocument(DOC, data);
    expect(parsed).toBeDefined();
    const rebuilt = buildAssetDocument(DOC, parsed as AssetDescription);
    expect([...rebuilt.match(null, namedNode(RDF_TYPE), null)].map((q) => q.object.value)).toEqual([
      CLASSES.video,
    ]);
  });
});
