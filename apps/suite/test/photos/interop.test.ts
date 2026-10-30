// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import {
  buildPhoto,
  PhotographDoc,
  parsePhoto,
  parsePhotos,
  photoStorage,
} from "../../src/apps/photos/lib/model/index.js";
import { mockPod } from "./pod.js";

const url = "https://pod.example/photos/items/a.ttl";
it("round-trips thumbnails and DCT timestamps independently of EXIF", () => {
  const photo = {
    name: "",
    contentUrl: "https://pod.example/original.jpg",
    thumbnailUrl: "https://pod.example/thumb.webp",
    created: "2026-10-25T00:00:00.000Z",
    modified: "2026-10-25T01:00:00.000Z",
    keywords: [],
    exif: {},
  };
  const dataset = buildPhoto(url, photo);
  expect(parsePhoto(url, dataset)).toEqual(photo);
  const doc = new PhotographDoc(`${url}#it`, dataset, DataFactory);
  doc.contentUrl = undefined;
  doc.thumbnailUrl = undefined;
  doc.geoRef = undefined;
  expect(parsePhoto(url, dataset)?.contentUrl).toBe("");
  expect(doc.thumbnailUrl).toBeUndefined();
  expect(doc.geoRef).toBeUndefined();
});
it("reads both Photograph items and PM ImageObject subjects without changing the write type", async () => {
  const turtle = `@prefix s: <https://schema.org/>. <#media-google-id> a s:ImageObject; s:name "Google image"; s:contentUrl <https://google.example/image>; s:dateCreated "2026-06-15T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>. <#it> a s:Photograph; s:contentUrl <https://pod.example/photo>. <#other> a s:VideoObject. [] a s:Thing.`;
  const dataset = await parseRdf(turtle, "text/turtle", { baseIRI: url });
  const photos = parsePhotos(url, dataset);
  expect(photos.map(({ subject }) => subject)).toEqual([`${url}#it`, `${url}#media-google-id`]);
  const imported = photos[1]?.photo;
  expect(imported?.exif.dateTimeOriginal).toBe("2026-06-15T00:00:00.000Z");
  expect(imported?.name).toBe("Google image");
  if (!imported) throw new Error("fixture");
  const written = new PhotographDoc(`${url}#it`, buildPhoto(url, imported), DataFactory);
  expect([...written.types]).toEqual(["https://schema.org/Photograph"]);
  const pod = mockPod();
  pod.files.set(url, { body: turtle, type: "text/turtle", etag: '"1"' });
  const io = photoStorage(pod.fetch, "https://pod.example/");
  expect((await io.loadPhotos(url)).photos).toEqual(photos);
});
