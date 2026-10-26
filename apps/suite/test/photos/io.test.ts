// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { PodScopeError } from "@jeswr/guarded-fetch";
import { Store } from "n3";
import { expect, it } from "vitest";
import { PhotoIoError, photoStorage } from "../../src/apps/photos/lib/model/io.js";
import { purgePhoto, trashPhoto } from "../../src/apps/photos/lib/model/trash.js";
import type { ImageEncoder } from "../../src/apps/photos/lib/model/upload.js";
import { tiffFixture } from "./fixtures.js";
import { mockPod } from "./pod.js";

const storage = "https://pod.example/";
const url = `${storage}photos/items/a.ttl`;
const photo = {
  name: "Test",
  contentUrl: `${storage}photos/originals/a.jpg`,
  keywords: [],
  exif: {},
};
const now = "2026-10-25T00:00:00.000Z";
const encoder: ImageEncoder = {
  dimensions: async () => ({ width: 4000, height: 3000 }),
  thumbnail: async () => new Blob(["webp"], { type: "image/webp" }),
  stripLocation: async (blob) => blob,
};
it("loads/saves photo and album through typed parsing and conditional Turtle writes", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  const { etag } = await io.savePhoto(url, photo, { create: true });
  expect(etag).toBe('"1"');
  const loaded = await io.loadPhoto(url);
  expect(loaded.photo).toEqual(photo);
  expect(loaded.etag).toBe(etag);
  expect(new Headers(pod.fetch.mock.calls.at(-1)?.[1]?.headers).get("cache-control")).toBe(
    "no-cache",
  );
  await io.savePhoto(url, { ...photo, name: "Updated" }, { etag: etag as string });
  await expect(io.savePhoto(url, photo, { etag: etag as string })).rejects.toMatchObject({
    status: 412,
  });
  await expect(io.savePhoto(url, photo, { create: true })).rejects.toBeInstanceOf(PhotoIoError);
  const albumUrl = `${storage}photos/albums/a.ttl`;
  const album = { name: "Album", members: [`${url}#it`] };
  await io.saveAlbum(albumUrl, album, { create: true });
  expect((await io.loadAlbum(albumUrl)).album).toEqual(album);
  expect(pod.files.get(albumUrl)?.type).toBe("text/turtle");
  await io.write(url, new Store(), { etag: '"2"' });
  expect((await io.loadPhoto(url)).photo).toBeUndefined();
  expect((await io.loadAlbum(url)).album).toBeUndefined();
});
it("creates containers safely and reads typed LDP listings", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.ensureContainers(["", "albums/"]);
  await io.ensureContainers(["", "albums/"]);
  const root = `${storage}photos/`;
  pod.files.set(root, {
    body: `<> <http://www.w3.org/ns/ldp#contains> <items/b.ttl>, <items/a.ttl>.`,
    type: "text/turtle",
    etag: '"listing"',
  });
  expect(await io.list(root)).toEqual([`${root}items/a.ttl`, `${root}items/b.ttl`]);
  pod.failures.set(`PUT ${root}thumbs/`, 403);
  await expect(io.ensureContainers(["thumbs/"])).rejects.toMatchObject({ status: 403 });
});
it("uses ETags for deletion and exposes fetch/HTTP errors", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  const { etag } = await io.savePhoto(url, photo, { create: true });
  await expect(io.savePhoto(url, photo, { etag: " " })).rejects.toThrow(TypeError);
  await expect(io.remove(url, "stale")).rejects.toMatchObject({ status: 412 });
  await io.remove(url, etag as string);
  pod.failures.set(`DELETE ${url}`, 404);
  await io.remove(url, "x");
  pod.failures.set(`DELETE ${url}`, 410);
  await io.remove(url, "x");
  await expect(io.loadPhoto(url)).rejects.toBeInstanceOf(RdfFetchError);
  pod.fetch.mockRejectedValueOnce(new Error("offline"));
  await expect(io.savePhoto(url, photo, { create: true })).rejects.toThrow("offline");
});
it("rejects scope escapes before fetch and follows no foreign redirects", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await expect(
    io.savePhoto(`${storage}other/a.ttl`, photo, { create: true }),
  ).rejects.toBeInstanceOf(PodScopeError);
  await expect(io.loadPhoto("https://evil.example/x.ttl")).rejects.toThrow();
  expect(pod.fetch).not.toHaveBeenCalled();
  pod.fetch.mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: "https://evil.example/x.ttl" } }),
  );
  await expect(io.loadPhoto(url)).rejects.toThrow();
  expect(pod.fetch).toHaveBeenCalledTimes(1);
  expect(() => photoStorage(pod.fetch, storage.slice(0, -1))).toThrow();
  expect(() => photoStorage(pod.fetch, `${storage}?x/`)).toThrow();
  expect(() => photoStorage(pod.fetch, `${storage}#x/`)).toThrow();
});
it("uploads original, thumbnail, then metadata with create-only preconditions", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  const input = {
    id: "a",
    name: "TIFF",
    original: new Blob([tiffFixture()], { type: "image/tiff" }),
    stripLocation: false,
  };
  const [uploaded] = await io.uploadPhotos([input], encoder, now);
  expect(uploaded?.photo.contentUrl).toBe(`${storage}photos/originals/a.tif`);
  expect((await io.loadPhoto(url)).photo?.thumbnailUrl).toBe(`${storage}photos/thumbs/a.webp`);
  expect([...pod.files.keys()].slice(-3)).toEqual([
    `${storage}photos/originals/a.tif`,
    `${storage}photos/thumbs/a.webp`,
    url,
  ]);
  expect(await io.uploadPhotos([], encoder, now)).toEqual([]);
  await expect(io.uploadPhotos([input], encoder, now)).rejects.toMatchObject({ status: 412 });
  const next = { ...input, id: "b" };
  pod.failures.set(`PUT ${storage}photos/thumbs/b.webp`, 507);
  await expect(io.uploadPhotos([next], encoder, now)).rejects.toMatchObject({ status: 507 });
  expect(pod.files.has(`${storage}photos/items/b.ttl`)).toBe(false);
});

it.each([
  "https://pod.example:443/",
  "https://POD.example/",
])("uses canonical photo identities from upload through purge for %s", async (base) => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, base);
  const [uploaded] = await io.uploadPhotos(
    [
      {
        id: "a",
        name: "TIFF",
        original: new Blob([tiffFixture()], { type: "image/tiff" }),
        stripLocation: false,
      },
    ],
    encoder,
    now,
  );
  expect(io.root).toBe(`${storage}photos/`);
  expect(uploaded?.itemUrl).toBe(url);
  expect(uploaded?.photo.contentUrl).toBe(`${io.root}originals/a.tif`);
  expect(uploaded?.photo.thumbnailUrl).toBe(`${io.root}thumbs/a.webp`);
  pod.files.set(io.root, {
    body: `<> <http://www.w3.org/ns/ldp#contains> <items/a.ttl>.`,
    type: "text/turtle",
    etag: '"listing"',
  });
  const [listed] = await io.list(io.root);
  expect(listed).toBe(url);
  expect((await io.loadPhoto(listed as string)).photo).toEqual(uploaded?.photo);
  const trash = await trashPhoto(io, url, "a", `${storage}profile/card#me`, now);
  await purgePhoto(io, trash);
  expect(pod.files.has(trash)).toBe(false);
  expect(pod.files.has(`${io.root}originals/a.tif`)).toBe(false);
  expect(pod.files.has(`${io.root}thumbs/a.webp`)).toBe(false);
});
