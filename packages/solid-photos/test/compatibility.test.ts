// AUTHORED-BY Codex (GPT-6.1 Sol)
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import {
  buildAlbum,
  buildPhoto,
  buildTrash,
  ImageGalleryDoc,
  ListItemDoc,
  PhotographDoc,
  parseAlbum,
  parsePhoto,
  parsePhotos,
  parseTrash,
  RestoreReceipt,
  serializePhotos,
  TrashDoc,
} from "../src/index.js";

const url = "https://pod.example/photos/items/a.ttl";
const albumUrl = "https://pod.example/photos/albums/a.ttl";
const trashUrl = "https://pod.example/photos/.trash/a.ttl";
const photo = {
  name: "Title",
  description: "Caption",
  contentUrl: "https://pod.example/photos/originals/a.jpg",
  thumbnailUrl: "https://pod.example/photos/thumbs/a.webp",
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-01-02T00:00:00.000Z",
  keywords: ["Sunset", "bay"],
  exif: {
    make: "FUJIFILM",
    model: "X-T5",
    lensModel: "XF 35mm",
    focalLengthMm: 35,
    fNumber: 1.4,
    exposureTimeSec: 0.008,
    iso: 200,
    orientation: 1,
    pixelWidth: 6240,
    pixelHeight: 4160,
    dateTimeOriginal: "2026-06-15T18:41:07.000Z",
    location: { lat: 51.5, long: -0.12 },
  },
};
const album = {
  name: "Holiday",
  description: "Our photos",
  coverUrl: `${url}#it`,
  dateCreated: photo.created,
  members: [`${url}#it`, "https://pod.example/photos/items/b.ttl#it"],
};
const record = {
  originalUrl: url,
  actor: "https://pod.example/profile/card#me",
  trashedAt: photo.created,
  state: "restoring" as const,
  restoreActivity: `${trashUrl}#restore`,
};

async function rdf(body: string) {
  return parseRdf(
    `@prefix s: <https://schema.org/>. @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
    @prefix dct: <http://purl.org/dc/terms/>. @prefix e: <http://www.w3.org/2003/12/exif/ns#>.
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>. ${body}`,
    "text/turtle",
    { baseIRI: url },
  );
}

it("keeps the original photo, album and trash serializer bytes and every written IRI", async () => {
  // Golden files captured by running the pre-extraction model with these exact values.
  for (const [name, dataset] of [
    ["photo", buildPhoto(url, photo)],
    ["album", buildAlbum(albumUrl, album)],
    ["trash", buildTrash(trashUrl, photo, record)],
  ] as const) {
    expect(await serializePhotos(dataset)).toBe(
      readFileSync(new URL(`./fixtures/${name}.ttl`, import.meta.url), "utf8"),
    );
  }
});

it("round-trips trash fields independently of app I/O and rejects incomplete records", () => {
  const dataset = buildTrash(trashUrl, photo, record);
  expect(parseTrash(trashUrl, dataset)).toEqual({
    photo: { ...photo, keywords: ["bay", "Sunset"] },
    record,
  });
  const doc = new TrashDoc(`${trashUrl}#trash`, dataset, DataFactory);
  expect(doc).toBeInstanceOf(RestoreReceipt);
  doc.originalUrl = undefined;
  expect(() => parseTrash(trashUrl, dataset)).toThrow("Invalid trash record");
  doc.originalUrl = url;
  doc.actor = undefined;
  expect(() => parseTrash(trashUrl, dataset)).toThrow("Invalid trash record");
  doc.actor = record.actor;
  doc.trashedAt = undefined;
  expect(() => parseTrash(trashUrl, dataset)).toThrow("Invalid trash record");
  doc.trashedAt = new Date(record.trashedAt);
  doc.state = "invalid";
  expect(() => parseTrash(trashUrl, dataset)).toThrow("Invalid trash state");
  expect(() => parseTrash(trashUrl, new Store())).toThrow();
});

it("keeps receipt-only tombstones untyped and preserves imported ImageObject types on edits", async () => {
  const dataset = new Store();
  const receipt = new RestoreReceipt(`${url}#it`, dataset, DataFactory);
  receipt.restoreActivity = record.restoreActivity;
  expect(receipt.restoreActivity).toBe(record.restoreActivity);
  expect(parsePhoto(url, dataset)).toBeUndefined();
  expect(dataset.size).toBe(1);
  receipt.restoreActivity = undefined;
  expect(dataset.size).toBe(0);
  const imported = await rdf('<#it> a s:ImageObject; s:name "Imported".');
  new PhotographDoc(`${url}#it`, imported, DataFactory).name = "Edited";
  expect(parsePhoto(url, imported)?.name).toBe("Edited");
  expect([...new PhotographDoc(`${url}#it`, imported, DataFactory).types]).toEqual([
    "https://schema.org/ImageObject",
  ]);
});

it("drops ambiguous singleton fields instead of selecting the first RDF value", async () => {
  const dataset = await rdf(
    '<#it> a s:Photograph; s:name "first", "second"; s:description "a", "b"; s:contentUrl <https://e.example/a>, <https://e.example/b>.',
  );
  expect(parsePhoto(url, dataset)).toEqual({ name: "", contentUrl: "", keywords: [], exif: {} });
  const gallery = await rdf('<#it> a s:ImageGallery; s:name "first", "second".');
  expect(parseAlbum(url, gallery)).toEqual({ name: "", members: [] });
});

it("drops language-tagged and non-string text instead of projecting their lexical text", async () => {
  const dataset = await rdf(
    '<#it> a s:Photograph; s:name "Hola"@es; s:description 5; s:keywords "tag"@en, 6, "plain".',
  );
  expect(parsePhoto(url, dataset)).toEqual({
    name: "",
    contentUrl: "",
    keywords: ["plain"],
    exif: {},
  });
  const gallery = await rdf('<#it> a s:ImageGallery; s:name "Hola"@es; s:description 5.');
  expect(parseAlbum(url, gallery)).toEqual({ name: "", members: [] });
});

it("requires the written numeric and date datatypes and valid XSD lexical forms", async () => {
  const dataset = await rdf(
    '<#it> a s:Photograph; s:width 12.0; e:fNumber 2.8; e:isoSpeedRatings " 200"^^xsd:integer; dct:created "2026-01-01"^^xsd:date; s:dateCreated "2026-02-30T00:00:00Z"^^xsd:dateTime.',
  );
  expect(parsePhoto(url, dataset)).toEqual({ name: "", contentUrl: "", keywords: [], exif: {} });
  const gallery = await rdf('<#it> a s:ImageGallery; s:dateCreated "2026-01-01"^^xsd:date.');
  expect(parseAlbum(url, gallery)).toEqual({ name: "", members: [] });
});

it("drops wrong-term IRI fields instead of throwing during optional reads", async () => {
  const dataset = await rdf(
    '<#it> a s:Photograph; s:contentUrl "not an IRI"; s:thumbnailUrl "wrong".',
  );
  expect(parsePhoto(url, dataset)).toEqual({ name: "", contentUrl: "", keywords: [], exif: {} });
  const gallery = await rdf(
    '<#it> a s:ImageGallery; s:image "wrong"; s:hasPart "wrong", <https://e.example/a>.',
  );
  expect(parseAlbum(url, gallery)).toEqual({ name: "", members: ["https://e.example/a"] });
});

it("recognizes Photograph, ImageObject and ImageGallery data-graph subclasses", async () => {
  for (const type of ["Photograph", "ImageObject"]) {
    const dataset = await rdf(
      `<#Subclass> rdfs:subClassOf s:${type}. <#it> a <#Subclass>; s:name "Child".`,
    );
    expect(parsePhoto(url, dataset)?.name).toBe("Child");
    expect(parsePhotos(url, dataset)).toEqual([
      { subject: `${url}#it`, photo: { name: "Child", contentUrl: "", keywords: [], exif: {} } },
    ]);
  }
  const gallery = await rdf("<#Subclass> rdfs:subClassOf s:ImageGallery. <#it> a <#Subclass>.");
  expect(parseAlbum(url, gallery)).toEqual({ name: "", members: [] });
});

it("drops invalid integer writes and rejects non-resource generated-wrapper subjects", () => {
  const dataset = new Store();
  const item = new ListItemDoc(`${url}#member`, dataset, DataFactory);
  item.position = 1.5;
  expect(item.position).toBeUndefined();
  const doc = new PhotographDoc(`${url}#it`, dataset, DataFactory);
  doc.width = Number.MAX_SAFE_INTEGER + 1;
  expect(doc.width).toBeUndefined();
  expect(() => new PhotographDoc(DataFactory.blankNode(), dataset, DataFactory)).toThrow(TypeError);
  expect(() => new ImageGalleryDoc(DataFactory.literal("wrong"), dataset, DataFactory)).toThrow(
    TypeError,
  );
});

it("retains permissive text writes and lexical IRI spelling from the original policy", () => {
  const dataset = buildPhoto(url, {
    ...photo,
    name: "a\u0000b",
    contentUrl: "https://EXAMPLE.org:443/ä.jpg",
    exif: {},
  });
  expect(parsePhoto(url, dataset)?.name).toBe("a\u0000b");
  expect(parsePhoto(url, dataset)?.contentUrl).toBe("https://EXAMPLE.org:443/ä.jpg");
  expect(() =>
    buildPhoto(url, { ...photo, contentUrl: "https://user:pass@example.org/a" }),
  ).toThrow(TypeError);
});

it("recognizes a trash Entity subclass and rejects ambiguous trash metadata", async () => {
  const dataset = buildTrash(trashUrl, photo, record);
  const doc = new TrashDoc(`${trashUrl}#trash`, dataset, DataFactory);
  doc.types.delete("http://www.w3.org/ns/prov#Entity");
  doc.types.add(`${trashUrl}#Subclass`);
  for (const quad of await rdf(
    `<${trashUrl}#Subclass> rdfs:subClassOf <http://www.w3.org/ns/prov#Entity>.`,
  ))
    dataset.add(quad);
  expect(parseTrash(trashUrl, dataset).record).toEqual(record);
  for (const quad of await rdf(
    `<${trashUrl}#trash> <http://www.w3.org/ns/prov#wasAttributedTo> <https://other.example/me>.`,
  ))
    dataset.add(quad);
  expect(() => parseTrash(trashUrl, dataset)).toThrow("Invalid trash record");
});

it("preserves clearing accessor types for strict consumers of the built package", async () => {
  await promisify(execFile)(process.execPath, [
    fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
    "-p",
    fileURLToPath(new URL("./tsconfig.consumer.json", import.meta.url)),
  ]);
}, 30_000);

it("skips unrelated non-HTTP subjects without changing public ListItem class identity", async () => {
  const dataset = await rdf("<urn:unrelated> a s:Thing. <#it> a s:Photograph.");
  expect(parsePhotos(url, dataset)).toHaveLength(1);
  const named = new ListItemDoc(`${url}#member`, dataset, DataFactory);
  const blank = new ListItemDoc(DataFactory.blankNode(), dataset, DataFactory);
  expect(named).toBeInstanceOf(ListItemDoc);
  expect(blank).toBeInstanceOf(ListItemDoc);
  blank.item = photo.contentUrl;
  blank.position = 1;
  expect(blank.item).toBe(photo.contentUrl);
  expect(blank.position).toBe(1);
  blank.item = undefined;
  blank.position = undefined;
  expect(blank.item).toBeUndefined();
  expect(blank.position).toBeUndefined();
});

it("rejects present invalid or ambiguous trash recovery metadata instead of treating it as legacy absence", async () => {
  for (const field of [
    "s:creativeWorkStatus <#purging>",
    's:creativeWorkStatus "purging", "restoring"',
    's:creativeWorkStatus "purging"^^xsd:integer',
    '<http://www.w3.org/ns/prov#wasGeneratedBy> "wrong"',
    "<http://www.w3.org/ns/prov#wasGeneratedBy> <#one>, <#two>",
  ]) {
    const dataset = buildTrash(trashUrl, photo, {
      originalUrl: record.originalUrl,
      actor: record.actor,
      trashedAt: record.trashedAt,
    });
    for (const quad of await rdf(`<${trashUrl}#trash> ${field}.`)) dataset.add(quad);
    expect(() => parseTrash(trashUrl, dataset)).toThrow(/Invalid trash (state|receipt)/);
  }
});

it("retains RDF term kinds for malformed album references", async () => {
  const dataset = await rdf(`<#it> a s:ImageGallery; s:itemListElement "${url}#entry".
    <#entry> s:item <${photo.contentUrl}>; s:position 1.`);
  const literal = new ListItemDoc(DataFactory.literal(`${url}#entry`), dataset, DataFactory);
  expect(literal.termType).toBe("Literal");
  expect(literal.item).toBeUndefined();
  expect(() => parseAlbum(url, dataset)).toThrow("Invalid album ListItem");
});
