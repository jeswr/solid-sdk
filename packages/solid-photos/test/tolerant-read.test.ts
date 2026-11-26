// AUTHORED-BY Claude Sonnet 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { expect, it } from "vitest";
import {
  addMember,
  buildAlbum,
  buildPhoto,
  parseAlbum,
  parsePhoto,
  parsePhotos,
  parseStoredAlbum,
  parseStoredPhoto,
} from "../src/index.js";

const url = "https://pod.example/photos/items/a.ttl";
const albumUrl = "https://pod.example/photos/albums/a.ttl";

async function rdf(body: string) {
  return parseRdf(
    `@prefix s: <https://schema.org/>. @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
    @prefix dct: <http://purl.org/dc/terms/>. @prefix e: <http://www.w3.org/2003/12/exif/ns#>.
    ${body}`,
    "text/turtle",
    { baseIRI: url },
  );
}

const IMPORTED =
  '<#it> a s:Photograph; s:name "Sunset"@en; s:description "Bay"@fr; s:contentUrl <https://pod.example/photos/originals/a.jpg>; s:width 6240.0; s:height 4160.0; e:fNumber 2.8; e:make "FUJI"@en; dct:created "2026-01-01"^^xsd:date; s:keywords "bay"@en, "sunset", 7.';

it("keeps language-tagged, decimal, xsd:date and multi-valued fields for write-back", async () => {
  const dataset = await rdf(`${IMPORTED} <#it> s:name "Second".`);
  // The strict read stays pinned: those fields drop.
  expect(parsePhoto(url, dataset)?.name).toBe("");
  const stored = parseStoredPhoto(url, dataset);
  expect(stored?.name).toMatch(/^(Sunset|Second)$/);
  expect(stored).toMatchObject({
    description: "Bay",
    created: "2026-01-01T00:00:00.000Z",
    keywords: ["7", "bay", "sunset"],
    exif: { make: "FUJI", fNumber: 2.8, pixelWidth: 6240, pixelHeight: 4160 },
  });
  expect(parsePhotos(url, dataset, { tolerant: true })[0]?.photo.description).toBe("Bay");
  expect(parsePhotos(url, dataset)[0]?.photo.description).toBeUndefined();
  // Rebuilding the tolerant read writes every value with the model's datatype.
  if (!stored) throw new Error("expected a photo");
  expect(parsePhoto(url, buildPhoto(url, stored))).toEqual(stored);
});

it("tolerant reads ignore IRIs and junk values and take the first usable value", async () => {
  const dataset = await rdf(
    '<#it> a s:Photograph; s:name <https://x.example/n>; s:width "wide", 5.0; s:dateCreated "nope", "2026-01-01T00:00:00Z"^^xsd:dateTime; s:contentUrl "str", <https://pod.example/a>, <https://pod.example/b>; s:thumbnailUrl "str"; s:description <https://x.example/d>.',
  );
  const stored = parseStoredPhoto(url, dataset);
  expect(stored?.name).toBe("");
  expect(stored?.description).toBeUndefined();
  expect(stored?.thumbnailUrl).toBeUndefined();
  expect(stored?.contentUrl).toMatch(/^https:\/\/pod\.example\/[ab]$/);
  expect(stored?.exif).toMatchObject({
    pixelWidth: 5,
    dateTimeOriginal: "2026-01-01T00:00:00.000Z",
  });
});

it.each([
  "javascript:alert(1)",
  "data:text/html,x",
  "file:///etc/passwd",
  "https://u:p@e.example/a",
])("drops the non-http(s) or credentialed IRI %s from photo and album reads", async (bad) => {
  const dataset = await rdf(
    `<#it> a s:Photograph; s:contentUrl <${bad}>; s:thumbnailUrl <${bad}>.`,
  );
  for (const read of [parsePhoto, parseStoredPhoto]) {
    const parsed = read(url, dataset);
    expect(parsed?.contentUrl).toBe("");
    expect(parsed?.thumbnailUrl).toBeUndefined();
  }
  const gallery = await rdf(`<#it> a s:ImageGallery; s:image <${bad}>.`);
  expect(parseAlbum(albumUrl, gallery)?.coverUrl).toBeUndefined();
});

it("keeps a language-tagged album name, description and xsd:date across a membership edit", async () => {
  const dataset = await parseRdf(
    `@prefix s: <https://schema.org/>. @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
    <#it> a s:ImageGallery; s:name "Holiday"@en; s:description "Trip"@fr; s:dateCreated "2026-02-03"^^xsd:date.`,
    "text/turtle",
    { baseIRI: albumUrl },
  );
  expect(parseAlbum(albumUrl, dataset)?.name).toBe("");
  const stored = parseStoredAlbum(albumUrl, dataset);
  expect(stored).toMatchObject({
    name: "Holiday",
    description: "Trip",
    dateCreated: "2026-02-03T00:00:00.000Z",
  });
  if (!stored) throw new Error("expected an album");
  const edited = addMember(stored, "https://pod.example/photos/items/a.ttl#it");
  expect(parseAlbum(albumUrl, buildAlbum(albumUrl, edited))).toEqual(edited);
});

it("reads lenient numbers as finite, non-empty and whole for integer fields, dates as UTC", async () => {
  const dataset = await rdf(
    `<#it> a s:Photograph; s:contentUrl <https://pod.example/photos/originals/a.jpg>;
      s:width ""^^xsd:integer; s:height "INF"^^xsd:double; e:isoSpeedRatings 100.5;
      e:fNumber "INF"^^xsd:double; e:orientation 6.0;
      dct:created "2026-01-01T10:00:00"^^xsd:dateTime.`,
  );
  const photo = parseStoredPhoto(url, dataset);
  expect(photo?.exif.pixelWidth).toBeUndefined();
  expect(photo?.exif.pixelHeight).toBeUndefined();
  expect(photo?.exif.iso).toBeUndefined();
  expect(photo?.exif.fNumber).toBeUndefined();
  expect(photo?.exif.orientation).toBe(6);
  // A zoneless dateTime is UTC regardless of the runner's TZ, as in the strict reader.
  expect(photo?.created).toBe("2026-01-01T10:00:00.000Z");
});
