// AUTHORED-BY Claude Sonnet 5.5
import { expect, it } from "vitest";
import { saveKeywords } from "../../src/apps/photos/lib/data/library.js";
import { photoStorage } from "../../src/apps/photos/lib/model/io.js";
import { parseTrash, restorePhoto, trashPhoto } from "../../src/apps/photos/lib/model/trash.js";
import { mockPod } from "./pod.js";

const storage = "https://pod.example/";
const itemUrl = `${storage}photos/items/a.ttl`;
const actor = `${storage}profile/card#me`;
const now = "2026-10-25T10:00:00.000Z";
// Authored by another Solid app: language tags, decimals, xsd:date, repeated values.
const FOREIGN = `
@prefix schema: <https://schema.org/>. @prefix exif: <http://www.w3.org/2003/12/exif/ns#>.
@prefix dct: <http://purl.org/dc/terms/>. @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
<#it> a schema:Photograph; schema:name "Sunset"@en; schema:description "Bay"@en;
  schema:contentUrl <${storage}photos/originals/a.jpg>;
  schema:width 6240.0; exif:fNumber 2.8; dct:created "2026-01-01"^^xsd:date;
  schema:keywords "bay"@en, "dusk" .`;

async function seeded() {
  const pod = mockPod();
  pod.files.set(itemUrl, { body: FOREIGN, type: "text/turtle", etag: '"seed"' });
  return { pod, io: photoStorage(pod.fetch, storage) };
}
const survivors = {
  name: "Sunset",
  description: "Bay",
  created: "2026-01-01T00:00:00.000Z",
  exif: { fNumber: 2.8, pixelWidth: 6240 },
};

it("keeps imported language-tagged, decimal, date and multi-valued metadata when keywords change", async () => {
  const { io } = await seeded();
  const { photo, etag } = await io.loadPhoto(itemUrl);
  if (!photo) throw new Error("fixture");
  expect(photo).toMatchObject(survivors);
  await saveKeywords(io, { ...photo, url: itemUrl, ref: `${itemUrl}#it`, etag } as never, [
    ...photo.keywords,
    "added",
  ]);
  const saved = (await io.loadPhoto(itemUrl)).photo;
  expect(saved).toMatchObject(survivors);
  expect(saved?.keywords).toEqual(["added", "bay", "dusk"]);
});

it("keeps that metadata through trash and restore", async () => {
  const { io } = await seeded();
  const trash = await trashPhoto(io, itemUrl, "a", actor, now);
  expect(parseTrash(trash, (await io.read(trash)).dataset).photo).toMatchObject({
    ...survivors,
    keywords: ["bay", "dusk"],
  });
  await restorePhoto(io, trash);
  expect((await io.loadPhoto(itemUrl)).photo).toMatchObject({
    ...survivors,
    keywords: ["bay", "dusk"],
  });
});

it("never exposes a non-http(s) contentUrl or thumbnail from a pod document", async () => {
  const pod = mockPod();
  pod.files.set(itemUrl, {
    body: `@prefix schema: <https://schema.org/>.
<#it> a schema:Photograph; schema:contentUrl <javascript:alert(1)>; schema:thumbnailUrl <data:text/html,x>.`,
    type: "text/turtle",
    etag: '"seed"',
  });
  const io = photoStorage(pod.fetch, storage);
  const { photo } = await io.loadPhoto(itemUrl);
  expect(photo?.contentUrl).toBe("");
  expect(photo?.thumbnailUrl).toBeUndefined();
  const listed = await io.loadPhotos(itemUrl);
  expect(listed.photos[0]?.photo.contentUrl).toBe("");
});
