// AUTHORED-BY Claude Sonnet 5.5
/**
 * `schema:ImageObject` documents written by other apps (creative-assets) are read as
 * photos; `schema:Photograph` is unchanged; a thumbnail is never a second photo; and
 * documents Pod Photos does not own are read-only (update and remove refuse before any
 * write).
 *
 * `ASSET_TTL` and `VIDEO_TTL` are the verbatim output of `serializeAssetDocument` from
 * `@jeswr/solid-creative-assets` (image with thumbnail, run, prompt, model and one
 * setting; and a video), with the document URL `https://alice.example/creative/2026/06/abc`.
 * An import-based interop test is still pending: it needs that package as an app
 * devDependency.
 */
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { parsePhoto, thumbnailDocuments } from "../src/photos/photograph.js";
import { albumsStore, photosStore } from "../src/photos/stores.js";
import { IMAGE_OBJECT_CLASS, PHOTOGRAPH_CLASS, SCHEMA } from "../src/photos/vocab.js";
import { ForeignDocumentError } from "../src/pod/errors.js";
import { containerTurtle, MockPod } from "./helpers/mock-pod.js";

const POD = "https://alice.example/";
const WEBID = "https://alice.example/profile/card#me";
const BASE = "https://alice.example/creative/2026/06/abc";

const ASSET_TTL = `@prefix schema: <https://schema.org/>.
@prefix prov: <http://www.w3.org/ns/prov#>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.

<${BASE}#it> a schema:ImageObject;
    prov:wasGeneratedBy <${BASE}#run>;
    schema:contentUrl <https://alice.example/creative/files/sunset.png>;
    schema:creator <https://alice.example/profile/card#me>;
    schema:dateCreated "2026-06-15T09:41:07.000Z"^^xsd:dateTime;
    schema:description "A red fox at sunset.";
    schema:encodingFormat "image/png";
    schema:height 768;
    schema:keywords "ai", "sunset";
    schema:name "Sunset fox";
    schema:thumbnail <${BASE}#thumbnail>;
    schema:width 1024.
<${BASE}#run> a prov:Activity;
    prov:used <${BASE}#prompt>, <${BASE}#setting-1>;
    prov:wasAssociatedWith <https://alice.example/profile/card#me>, <${BASE}#model>.
<${BASE}#thumbnail> a schema:ImageObject;
    schema:contentUrl <https://alice.example/creative/files/sunset-thumb.webp>;
    schema:encodingFormat "image/webp";
    schema:height 96;
    schema:width 128.
<${BASE}#prompt> a schema:CreativeWork, prov:Entity;
    schema:text "a red fox at sunset".
<${BASE}#setting-1> a schema:PropertyValue;
    schema:propertyID "seed";
    schema:value "42".
<${BASE}#model> a schema:SoftwareApplication, prov:SoftwareAgent;
    schema:name "Flux Pro";
    schema:identifier "flux-pro-1.1".
`;

const VIDEO_TTL = `@prefix schema: <https://schema.org/>.
<${BASE}#it> a schema:VideoObject;
    schema:contentUrl <https://alice.example/creative/files/fox.mp4>;
    schema:name "Fox run".
`;

/** Move a fixture document to another URL. */
const at = (ttl: string, url: string) => ttl.replaceAll(BASE, url);
const parse = (ttl: string, url = BASE) => new Store(new Parser({ baseIRI: url }).parse(ttl));
const typed = (type: string) =>
  ASSET_TTL.replace(
    "a schema:ImageObject;\n    prov:wasGeneratedBy",
    `a ${type};\n    prov:wasGeneratedBy`,
  );

const SUNSET = {
  name: "Sunset fox",
  description: "A red fox at sunset.",
  contentUrl: "https://alice.example/creative/files/sunset.png",
  keywords: ["ai", "sunset"],
  exif: { pixelWidth: 1024, pixelHeight: 768, dateTimeOriginal: "2026-06-15T09:41:07.000Z" },
};

describe("parsePhoto: schema:ImageObject", () => {
  it("reads a creative-assets image document as a photo", () => {
    expect(parsePhoto(BASE, parse(ASSET_TTL))).toEqual(SUNSET);
  });

  it("still reads a schema:Photograph", () => {
    expect(parsePhoto(BASE, parse(typed("schema:Photograph")))).toEqual(SUNSET);
  });

  it("reads one photo per document: the #thumbnail image is not a second photo", () => {
    // Only <doc#it> is a photo subject, so the thumbnail's own dimensions never leak.
    const photo = parsePhoto(BASE, parse(ASSET_TTL));
    expect(photo?.exif.pixelWidth).toBe(1024);
    expect(photo?.contentUrl).not.toContain("thumb");
  });

  it("does not read a video document as a photo", () => {
    expect(parsePhoto(BASE, parse(VIDEO_TTL))).toBeUndefined();
  });

  it("skips an ImageObject that another node names as its thumbnail", () => {
    const ds = parse(`
      <${BASE}#parent> <${SCHEMA}thumbnail> <${BASE}#it> .
      <${BASE}#it> a <${IMAGE_OBJECT_CLASS}> ; <${SCHEMA}name> "thumb" .
    `);
    expect(parsePhoto(BASE, ds)).toBeUndefined();
  });

  it("reads a Photograph even when a node names it as a thumbnail", () => {
    const ds = parse(`
      <${BASE}#parent> <${SCHEMA}thumbnail> <${BASE}#it> .
      <${BASE}#it> a <${PHOTOGRAPH_CLASS}> ; <${SCHEMA}name> "keep" .
    `);
    expect(parsePhoto(BASE, ds)?.name).toBe("keep");
  });

  it("behaves as before for the legacy http://schema.org/ scheme (not a photo)", () => {
    for (const type of ["Photograph", "ImageObject"]) {
      const legacy = `<${BASE}#it> a <http://schema.org/${type}> ; <http://schema.org/name> "Old" .`;
      expect(parsePhoto(BASE, parse(legacy))).toBeUndefined();
    }
  });
});

describe("thumbnailDocuments", () => {
  it("names a thumbnail kept in another document, not the document itself", () => {
    const other = "https://alice.example/creative/2026/06/abc-thumb";
    const ds = parse(`
      <${BASE}#it> <${SCHEMA}thumbnail> <${other}#it>, <${BASE}#thumbnail>, "text" .
    `);
    expect(thumbnailDocuments(BASE, ds)).toEqual([other]);
  });
});

describe("listing through the store", () => {
  it("lists an ImageObject, a Photograph and a creative-assets document once each, and skips other types", async () => {
    const pod = new MockPod();
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    const [a, b, c, d] = ["a", "b", "c", "d"].map((n) => `${POD}photos/${n}`);
    pod.seed(a as string, at(ASSET_TTL, a as string));
    pod.seed(b as string, at(typed("schema:Photograph"), b as string));
    pod.seed(c as string, at(VIDEO_TTL, c as string));
    // A malformed ImageObject (literal contentUrl) is skipped, not thrown out of the list.
    pod.seed(
      d as string,
      `<${d}#it> a <${IMAGE_OBJECT_CLASS}> ; <${SCHEMA}contentUrl> "not an iri" .`,
    );
    pod.seed(`${POD}photos/`, containerTurtle(`${POD}photos/`, [a, b, c, d] as string[]));
    const listed = await store.list();
    expect(listed.map((i) => i.url)).toEqual([a, b]);
    expect(listed.map((i) => i.data)).toEqual([SUNSET, SUNSET]);
  });
});

describe("foreign documents are read-only", () => {
  const PHOTO = { ...SUNSET, name: "Renamed" };

  function setup(ttl: string | undefined) {
    const pod = new MockPod();
    const url = `${POD}photos/doc`;
    if (ttl !== undefined) pod.seed(url, at(ttl, url));
    const writes: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") writes.push(`${method} ${String(input)}`);
      return pod.fetch(input, init);
    }) as typeof fetch;
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl });
    return { pod, url, writes, store };
  }

  it.each([
    ["an ImageObject", ASSET_TTL],
    ["a video document", VIDEO_TTL],
    [
      "a document with no photo node",
      `<https://alice.example/photos/doc#other> <${SCHEMA}name> "x" .`,
    ],
  ])("refuses update and remove of %s with zero write requests", async (_label, ttl) => {
    const { pod, url, writes, store } = setup(ttl);
    const before = pod.resources.get(url)?.body;
    await expect(store.update(url, PHOTO)).rejects.toBeInstanceOf(ForeignDocumentError);
    await expect(store.update(url, PHOTO, '"etag-1"')).rejects.toBeInstanceOf(ForeignDocumentError);
    await expect(store.remove(url)).rejects.toBeInstanceOf(ForeignDocumentError);
    expect(writes).toEqual([]);
    expect(pod.resources.get(url)?.body).toBe(before);
  });

  it("still updates and removes a genuine Photograph", async () => {
    const { pod, url, writes, store } = setup(typed("schema:Photograph"));
    await store.update(url, PHOTO);
    expect(writes).toEqual([`PUT ${url}`]);
    expect((await store.read(url))?.data.name).toBe("Renamed");
    await store.remove(url);
    expect(pod.resources.has(url)).toBe(false);
  });

  it("writes a missing document as before (no document to protect)", async () => {
    const { writes, url, store } = setup(undefined);
    await store.update(url, PHOTO);
    expect(writes).toEqual([`PUT ${url}`]);
    const gone = setup(undefined);
    await gone.store.remove(gone.url);
    expect(gone.writes).toEqual([`DELETE ${gone.url}`]);
  });

  it("writes nothing when the existing document cannot be read", async () => {
    const { writes, store, url } = setup("this is { not turtle");
    await expect(store.update(url, PHOTO)).rejects.toBeDefined();
    await expect(store.remove(url)).rejects.toBeDefined();
    expect(writes).toEqual([]);
  });

  it("does not guard albums (they are always this app’s own documents)", async () => {
    const pod = new MockPod();
    const albums = albumsStore({ podRoot: POD, webId: WEBID, fetchImpl: pod.fetch });
    const url = `${POD}albums/trip`;
    pod.seed(url, `<${url}#it> a <${SCHEMA}ImageGallery> ; <${SCHEMA}name> "Trip" .`);
    await albums.update(url, { name: "Trip 2", members: [`${BASE}#it`] });
    expect((await albums.read(url))?.data.name).toBe("Trip 2");
  });
});

describe("RdfFetchError is what a missing document raises", () => {
  it("read of a missing photo document is a 404", async () => {
    const store = photosStore({ podRoot: POD, webId: WEBID, fetchImpl: new MockPod().fetch });
    await expect(store.read(`${POD}photos/none`)).rejects.toMatchObject({ status: 404 });
    await expect(store.read(`${POD}photos/none`)).rejects.toBeInstanceOf(RdfFetchError);
  });
});
