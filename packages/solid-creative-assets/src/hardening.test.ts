// AUTHORED-BY Claude Sonnet 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { DOC, fullImage, graphOf, mesh } from "../test/fixtures.js";
import {
  type AssetDescription,
  buildAssetDocument,
  documentUrl,
  MAX_SETTINGS,
  nodeIri,
  parseAssetDocument,
} from "./assets.js";
import {
  buildCollection,
  buildProjectDocument,
  documentToTurtle,
  parseAssetDocumentTtl,
  parseProjectDocument,
  serializeAssetDocument,
} from "./documents.js";
import { CLASSES, RDF_TYPE } from "./vocab.js";

const { namedNode, literal, quad } = DataFactory;
const SCHEMA = "https://schema.org/";
const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const it0 = `${DOC}#it`;
const ttl = (body: string): Promise<DatasetCore> =>
  parseRdf(
    `@prefix schema: <https://schema.org/> . @prefix prov: <http://www.w3.org/ns/prov#> .
     @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n${body}`,
    "text/turtle",
    { baseIRI: DOC },
  );
const image = (asset: object = {}, extra: object = {}): AssetDescription =>
  ({
    kind: "image",
    asset: { contentUrl: "https://pod.example/f.png", ...asset },
    ...extra,
  }) as AssetDescription;

describe("document URLs", () => {
  it("accepts only a normalised http(s) URL without userinfo or fragment", () => {
    expect(documentUrl(DOC)).toBe(DOC);
    expect(documentUrl("http://pod.example/a?q=1")).toBe("http://pod.example/a?q=1");
    for (const url of [
      "https://pod.example/créations/fox",
      "HTTPS://POD.example/x",
      "https://pod.example:443/x",
      "http://pod.example:80/x",
      "https://pod.example/a/../x",
      "https://pod.example",
      "https://pod.example/a?q=é",
      "https://user:pw@pod.example/x",
      "https://pod.example/x#frag",
      "urn:x:y",
      "file:///etc/passwd",
      "ftp://pod.example/x",
      "relative/x",
      "",
    ]) {
      expect(() => documentUrl(url), url).toThrow(TypeError);
    }
  });

  it("works for a percent-encoded non-ASCII path, keeping every link connected", () => {
    const url = "https://pod.example/cr%C3%A9ations/fox";
    const store = buildAssetDocument(url, fullImage);
    expect(parseAssetDocument(url, store)).toEqual(fullImage);
    expect(() => buildAssetDocument("https://pod.example/créations/fox", fullImage)).toThrow(
      TypeError,
    );
  });

  it("nodeIri only builds the fragments this package writes", () => {
    expect(nodeIri(DOC, "setting-12")).toBe(`${DOC}#setting-12`);
    for (const fragment of ["a b#c>", "", "setting-", "setting-01", "setting-1000", "other"]) {
      expect(() => nodeIri(DOC, fragment), fragment).toThrow(TypeError);
    }
  });
});

describe("writes fail closed for every supplied value", () => {
  const cases: [string, AssetDescription][] = [
    ["non-integer width", image({ width: 10.5 })],
    ["huge width", image({ width: 2 ** 60 })],
    ["zero width", image({ width: 0 })],
    ["negative height", image({ height: -5 })],
    ["invalid date", image({ dateCreated: new Date(Number.NaN) })],
    ["creator without a scheme", image({ creator: "alice" })],
    ["non-http member of wasDerivedFrom", image({ wasDerivedFrom: ["javascript:x"] })],
    ["non-http member of isBasedOn", image({ isBasedOn: ["https://ok.example/a", "x"] })],
    ["non-http usedAssets", image({}, { generation: { usedAssets: ["javascript:x"] } })],
    ["bad provider", image({}, { generation: { model: { provider: "bfl" } } })],
    [
      "bad thumbnail width",
      image({}, { thumbnail: { contentUrl: "https://t.example/t.png", width: 1.5 } }),
    ],
    ["invalid run start", image({}, { generation: { startedAtTime: new Date(Number.NaN) } })],
    ["invalid associatedWith", image({}, { generation: { associatedWith: ["nope"] } })],
  ];
  for (const [name, description] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => buildAssetDocument(DOC, description)).toThrow(TypeError);
    });
  }

  it("names the dropped field", () => {
    expect(() => buildAssetDocument(DOC, image({ width: 10.5 }))).toThrow(/width/);
    expect(() => buildAssetDocument(DOC, image({ creator: "alice" }))).toThrow(/creator/);
  });

  it("applies to collections and project documents, and a collection needs a name", () => {
    expect(() => buildCollection(DOC, { name: "c", hasPart: ["javascript:x"] })).toThrow(/hasPart/);
    expect(() => buildCollection(DOC, {})).toThrow(TypeError);
    expect(() =>
      buildProjectDocument(DOC, {
        contentUrl: "https://p.example/s.json",
        dateCreated: new Date(Number.NaN),
      }),
    ).toThrow(/dateCreated/);
    expect(() =>
      buildProjectDocument(DOC, { contentUrl: "https://p.example/s.json", hasPart: ["x"] }),
    ).toThrow(/hasPart/);
  });

  it("accepts a duration in xsd:duration form and rejects one that is not", () => {
    const video = (duration: string): AssetDescription => ({
      kind: "video",
      asset: { contentUrl: "https://pod.example/v.mp4", duration },
    });
    expect(
      parseAssetDocument(DOC, buildAssetDocument(DOC, video("PT1M5.5S")))?.asset,
    ).toMatchObject({ duration: "PT1M5.5S" });
    for (const bad of ["not a duration", "P1W", ""]) {
      expect(() => buildAssetDocument(DOC, video(bad)), bad).toThrow(TypeError);
    }
  });

  it("returns a connected graph: the supplied model node reads back", () => {
    const withModel = image({}, { generation: { model: { name: "m" } } });
    const store = buildAssetDocument(DOC, withModel);
    expect(parseAssetDocument(DOC, store)?.generation?.model).toEqual({ name: "m" });
  });
});

describe("reserved fragments and copied keys", () => {
  it("rejects caller IRIs that name this document's own nodes", () => {
    for (const reserved of ["#prompt", "#setting-9", "#model", "#run", "#thumbnail", "#it"]) {
      const iri = `${DOC}${reserved}`;
      expect(
        () => buildAssetDocument(DOC, image({}, { generation: { usedAssets: [iri] } })),
        iri,
      ).toThrow(TypeError);
      expect(() =>
        buildAssetDocument(DOC, image({}, { generation: { associatedWith: [iri] } })),
      ).toThrow(TypeError);
      expect(() => buildAssetDocument(DOC, image({ wasDerivedFrom: [iri] }))).toThrow(TypeError);
    }
    expect(() =>
      buildAssetDocument(DOC, image({}, { generation: { usedAssets: [`${DOC}#other`] } })),
    ).not.toThrow();
  });

  it("throws on an unknown kind, even with a thumbnail or generation", () => {
    const bad = {
      kind: "audio",
      asset: { contentUrl: "https://pod.example/a.mp3" },
      generation: { prompt: "x" },
    };
    expect(() => buildAssetDocument(DOC, bad as never)).toThrow(TypeError);
  });

  it("copies only known keys: smuggled links and text are not written", () => {
    const smuggled = image({
      thumbnail: `${DOC}#thumbnail`,
      wasGeneratedBy: `${DOC}#run`,
      extra: 1,
    });
    const store = buildAssetDocument(DOC, smuggled);
    expect(
      [...store]
        .map((q) => q.predicate.value)
        .some((p) => p.endsWith("thumbnail") || p.endsWith("wasGeneratedBy")),
    ).toBe(false);
    const project = buildProjectDocument(DOC, {
      contentUrl: "https://p.example/s.json",
      text: "smuggled",
    } as never);
    expect([...project].some((q) => q.predicate.value === `${SCHEMA}text`)).toBe(false);
  });
});

describe("what parse(build(x)) normalises", () => {
  it("normalises the contentUrl to its URL form", () => {
    const parsed = parseAssetDocument(
      DOC,
      buildAssetDocument(DOC, image({ contentUrl: "HTTPS://Pod.Example/a b" })),
    );
    expect(parsed?.asset.contentUrl).toBe("https://pod.example/a%20b");
  });

  it("sorts and de-duplicates keywords and drops an empty list", () => {
    expect(
      parseAssetDocument(DOC, buildAssetDocument(DOC, image({ keywords: ["b", "a", "b"] })))?.asset
        .keywords,
    ).toEqual(["a", "b"]);
    expect(
      parseAssetDocument(DOC, buildAssetDocument(DOC, image({ keywords: [] })))?.asset,
    ).not.toHaveProperty("keywords");
  });

  it("de-duplicates IRI sets", () => {
    const src = "https://pod.example/src#it";
    const parsed = parseAssetDocument(
      DOC,
      buildAssetDocument(
        DOC,
        image(
          { wasDerivedFrom: [src, src] },
          { generation: { usedAssets: [src, src], associatedWith: [src, src] } },
        ),
      ),
    );
    expect(parsed?.asset.wasDerivedFrom).toEqual([src]);
    expect(parsed?.generation?.usedAssets).toEqual([src]);
    expect(parsed?.generation?.associatedWith).toEqual([src]);
  });

  it("strips control characters from text, including a prompt", () => {
    const parsed = parseAssetDocument(
      DOC,
      buildAssetDocument(DOC, image({ name: "a\u0000b" }, { generation: { prompt: "a\u0000b" } })),
    );
    expect(parsed?.asset.name).toBe("ab");
    expect(parsed?.generation?.prompt).toBe("ab");
  });
});

describe("what parse-then-rebuild loses", () => {
  it("drops links to other documents, which are never followed", async () => {
    const data =
      await ttl(`<${it0}> a schema:ImageObject ; schema:contentUrl <https://pod.example/f.png> ;
      schema:thumbnail <https://other.example/t#it> ; prov:wasGeneratedBy <https://other.example/r#run> .`);
    const parsed = parseAssetDocument(DOC, data) as AssetDescription;
    const rebuilt = buildAssetDocument(DOC, parsed);
    expect([...rebuilt].filter((q) => q.object.value.startsWith("https://other.example"))).toEqual(
      [],
    );
  });

  it("loses the whole generation when wasGeneratedBy has two values", async () => {
    const data =
      await ttl(`<${it0}> a schema:ImageObject ; schema:contentUrl <https://pod.example/f.png> ;
      prov:wasGeneratedBy <${DOC}#run>, <https://other.example/r#run> .
      <${DOC}#run> a prov:Activity ; prov:startedAtTime "2026-01-01T00:00:00Z"^^xsd:dateTime .`);
    expect(parseAssetDocument(DOC, data)?.generation).toBeUndefined();
  });
});

describe("settings", () => {
  const settings = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ propertyID: `p${i}`, value: `${i}` }));

  it("caps settings at 256 on build", () => {
    expect(() =>
      buildAssetDocument(DOC, { ...mesh, generation: { settings: settings(MAX_SETTINGS + 1) } }),
    ).toThrow(TypeError);
    const ok = buildAssetDocument(DOC, {
      ...mesh,
      generation: { settings: settings(MAX_SETTINGS) },
    });
    expect(parseAssetDocument(DOC, ok)?.generation?.settings).toHaveLength(MAX_SETTINGS);
  });

  it("returns a parse failure, not a partial object, above the cap", async () => {
    const lines = settings(MAX_SETTINGS + 1).map((_, i) => `<${DOC}#setting-${i + 1}>`);
    const body = lines
      .map((s, i) => `${s} a schema:PropertyValue ; schema:propertyID "p${i}" ; schema:value "v" .`)
      .join("\n");
    const data =
      await ttl(`<${it0}> a schema:3DModel ; schema:contentUrl <https://pod.example/m.glb> ; prov:wasGeneratedBy <${DOC}#run> .
      <${DOC}#run> a prov:Activity ; prov:used ${lines.join(", ")} .\n${body}`);
    expect(parseAssetDocument(DOC, data)).toBeUndefined();
  });

  it("accepts only canonical setting fragments; anything else is an ordinary used IRI", async () => {
    const odd = [
      "setting-",
      "setting-1e3",
      "setting-0x10",
      "setting-01",
      "setting-1.0",
      "setting--5",
      "setting-1000",
    ];
    const nodes = odd
      .map(
        (f) => `<${DOC}#${f}> a schema:PropertyValue ; schema:propertyID "p" ; schema:value "v" .`,
      )
      .join("\n");
    const data =
      await ttl(`<${it0}> a schema:3DModel ; schema:contentUrl <https://pod.example/m.glb> ; prov:wasGeneratedBy <${DOC}#run> .
      <${DOC}#run> a prov:Activity ; prov:used ${odd.map((f) => `<${DOC}#${f}>`).join(", ")}, <${DOC}#setting-3> .
      <${DOC}#setting-3> a schema:PropertyValue ; schema:propertyID "ok" ; schema:value "v" .\n${nodes}`);
    const generation = parseAssetDocument(DOC, data)?.generation;
    expect(generation?.settings).toEqual([{ propertyID: "ok", value: "v" }]);
    expect(generation?.usedAssets?.sort()).toEqual(odd.map((f) => `${DOC}#${f}`).sort());
  });

  it("returns settings in numeric order whatever the store order", () => {
    const items = settings(12);
    const store = buildAssetDocument(DOC, { ...mesh, generation: { settings: items } });
    const shuffled = new Store([...store].reverse());
    expect(parseAssetDocument(DOC, shuffled)?.generation?.settings).toEqual(items);
  });

  it("ignores settings that live in another document", async () => {
    const data =
      await ttl(`<${it0}> a schema:3DModel ; schema:contentUrl <https://pod.example/m.glb> ; prov:wasGeneratedBy <${DOC}#run> .
      <${DOC}#run> a prov:Activity ; prov:used <https://other.example/d#setting-1> .
      <https://other.example/d#setting-1> a schema:PropertyValue ; schema:propertyID "seed" ; schema:value "1" .`);
    const generation = parseAssetDocument(DOC, data)?.generation;
    expect(generation?.settings).toBeUndefined();
    expect(generation?.usedAssets).toEqual(["https://other.example/d#setting-1"]);
  });
});

describe("links must point at this document's own nodes", () => {
  it("does not follow a typed thumbnail node in another document", async () => {
    const data =
      await ttl(`<${it0}> a schema:ImageObject ; schema:contentUrl <https://pod.example/f.png> ;
        schema:thumbnail <https://other.example/t#it> .
      <https://other.example/t#it> a schema:ImageObject ; schema:contentUrl <https://other.example/t.png> .`);
    expect(parseAssetDocument(DOC, data)?.thumbnail).toBeUndefined();
  });

  it("does not treat a wasGeneratedBy other than #run as the run", async () => {
    const data =
      await ttl(`<${it0}> a schema:ImageObject ; schema:contentUrl <https://pod.example/f.png> ;
        prov:wasGeneratedBy <${DOC}#other> .
      <${DOC}#other> a prov:Activity ; prov:startedAtTime "2026-01-01T00:00:00Z"^^xsd:dateTime .
      <${DOC}#run> a prov:Activity ; prov:startedAtTime "2027-01-01T00:00:00Z"^^xsd:dateTime .`);
    expect(parseAssetDocument(DOC, data)?.generation).toBeUndefined();
  });

  it("keeps a prompt link whose node has no text and a model link whose node is not a model", async () => {
    const data =
      await ttl(`<${it0}> a schema:ImageObject ; schema:contentUrl <https://pod.example/f.png> ; prov:wasGeneratedBy <${DOC}#run> .
      <${DOC}#run> a prov:Activity ; prov:used <${DOC}#prompt> ; prov:wasAssociatedWith <${DOC}#model> .
      <${DOC}#prompt> a schema:CreativeWork ; schema:name "no text" .
      <${DOC}#model> a schema:Person ; schema:name "x" .`);
    expect(parseAssetDocument(DOC, data)?.generation).toEqual({});
  });

  it("reads a thumbnail that has only a contentUrl", () => {
    const d = image({}, { thumbnail: { contentUrl: "https://pod.example/t.png" } });
    expect(parseAssetDocument(DOC, buildAssetDocument(DOC, d))).toEqual(d);
  });
});

describe("parse budget and base IRI", () => {
  /** `<node> a ex:C0`, `ex:Ci subClassOf ex:Ci+1`, the last subClassOf `target`. */
  function chain(store: Store, node: string, length: number, target: string): void {
    const cls = (i: number) => namedNode(`https://ex.example/C${i}`);
    store.addQuad(quad(namedNode(node), namedNode(RDF_TYPE), cls(0)));
    for (let i = 0; i < length; i++) {
      store.addQuad(
        quad(cls(i), namedNode(RDFS_SUBCLASS), i === length - 1 ? namedNode(target) : cls(i + 1)),
      );
    }
  }
  const withModel = (): Store => {
    const store = buildAssetDocument(DOC, image({}, { generation: { prompt: "p" } }));
    store.addQuad(
      quad(
        namedNode(`${DOC}#run`),
        namedNode("http://www.w3.org/ns/prov#wasAssociatedWith"),
        namedNode(`${DOC}#model`),
      ),
    );
    store.addQuad(quad(namedNode(`${DOC}#model`), namedNode(`${SCHEMA}name`), literal("deep")));
    return store;
  };

  it("uses one parse scope: a 20,000-deep subclass chain is read", () => {
    const store = withModel();
    chain(store, `${DOC}#model`, 20_000, CLASSES.aiModel);
    expect(parseAssetDocument(DOC, store)?.generation?.model).toEqual({ name: "deep" });
  });

  it("returns undefined, not a partial description, when the parse budget is exhausted", () => {
    const store = withModel();
    chain(store, `${DOC}#model`, 100_500, CLASSES.aiModel);
    expect(parseAssetDocument(DOC, store)).toBeUndefined();
  });

  it("resolves a relative <#it> against the document URL", async () => {
    const body = `@prefix schema: <https://schema.org/> . <#it> a schema:ImageObject ; schema:contentUrl <f.png> .`;
    expect(await parseAssetDocumentTtl(DOC, body)).toEqual({
      kind: "image",
      asset: { contentUrl: "https://pod.example/creative/assets/f.png" },
    });
  });
});

describe("legacy predicates", () => {
  it("refuses to write a document that still holds legacy predicates", async () => {
    const data = await ttl(
      `<${it0}> a <http://schema.org/ImageObject> ; <http://schema.org/contentUrl> <https://pod.example/f.png> .`,
    );
    expect(() => documentToTurtle(new Store([...data]))).toThrow(TypeError);
  });

  it("still writes a legacy-typed document with canonical predicates", async () => {
    const text = await serializeAssetDocument(DOC, mesh);
    expect(graphOf(await parseRdf(text, "text/turtle", { baseIRI: DOC })).length).toBeGreaterThan(
      0,
    );
  });
});
