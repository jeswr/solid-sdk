// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import { photoStorage } from "../../src/apps/photos/lib/model/io.js";
import { PhotographDoc } from "../../src/apps/photos/lib/model/photograph.js";
import {
  buildTrash,
  parseTrash,
  purgePhoto,
  restorePhoto,
  TrashDoc,
  trashPhoto,
} from "../../src/apps/photos/lib/model/trash.js";
import { mockPod } from "./pod.js";

const storage = "https://pod.example/";
const originalUrl = `${storage}photos/items/a.ttl`;
const url = `${storage}photos/.trash/a.ttl`;
const actor = `${storage}profile/card#me`;
const now = "2026-10-25T10:00:00.000Z";
const photo = {
  name: "Test",
  contentUrl: `${storage}photos/originals/a.jpg`,
  thumbnailUrl: `${storage}photos/thumbs/a.webp`,
  keywords: [],
  exif: {},
};
const record = { originalUrl, actor, trashedAt: now };
it("round-trips PROV trash records with the original photo identity", () => {
  const dataset = buildTrash(url, photo, record);
  expect(parseTrash(url, dataset)).toEqual({ photo, record });
  expect(new PhotographDoc(`${originalUrl}#it`, dataset, DataFactory).name).toBe("Test");
  const doc = new TrashDoc(`${url}#trash`, dataset, DataFactory);
  doc.originalUrl = undefined;
  expect(() => parseTrash(url, dataset)).toThrow();
  doc.originalUrl = originalUrl;
  doc.actor = undefined;
  expect(() => parseTrash(url, dataset)).toThrow();
  doc.actor = actor;
  doc.trashedAt = undefined;
  expect(() => parseTrash(url, dataset)).toThrow();
  expect(() => parseTrash(url, new Store())).toThrow();
  const missingPhoto = new Store();
  const missingDoc = new TrashDoc(`${url}#trash`, missingPhoto, DataFactory);
  missingDoc.types.add("http://www.w3.org/ns/prov#Entity");
  missingDoc.originalUrl = originalUrl;
  missingDoc.actor = actor;
  missingDoc.trashedAt = new Date(now);
  expect(() => parseTrash(url, missingPhoto)).toThrow("Missing trashed photograph");
});
it("trashes, restores create-only, then purges owned binaries and metadata last", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.savePhoto(originalUrl, photo, { create: true });
  const trash = await trashPhoto(io, originalUrl, "a", actor, now);
  expect(trash).toBe(url);
  expect(pod.files.has(originalUrl)).toBe(false);
  expect(parseTrash(url, (await io.read(url)).dataset).photo).toEqual(photo);
  expect(await restorePhoto(io, url)).toBe(originalUrl);
  expect(pod.files.has(url)).toBe(false);
  await trashPhoto(io, originalUrl, "a", actor, now);
  for (const binary of [photo.contentUrl, photo.thumbnailUrl])
    pod.files.set(binary, { body: new Blob(), type: "image/jpeg", etag: '"binary"' });
  await purgePhoto(io, url);
  expect(pod.files.has(url)).toBe(false);
  expect(pod.files.has(photo.contentUrl)).toBe(false);
  expect(pod.files.has(photo.thumbnailUrl)).toBe(false);
});
it("keeps a recoverable trash copy on delete failure and refuses restore collisions", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.savePhoto(originalUrl, photo, { create: true });
  pod.failures.set(`DELETE ${originalUrl}`, 412);
  await expect(trashPhoto(io, originalUrl, "a", actor, now)).rejects.toMatchObject({ status: 412 });
  expect(pod.files.has(originalUrl)).toBe(true);
  expect(pod.files.has(url)).toBe(true);
  await expect(restorePhoto(io, url)).rejects.toMatchObject({ status: 412 });
  expect(pod.files.has(url)).toBe(true);
});
it("requires valid photos and ETags before moving or deleting metadata", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.write(originalUrl, new Store(), { create: true });
  await expect(trashPhoto(io, originalUrl, "a", actor, now)).rejects.toThrow("Not a photograph");
  await io.savePhoto(originalUrl, photo, { etag: '"1"' });
  const file = pod.files.get(originalUrl);
  if (!file) throw new Error("fixture");
  file.etag = null;
  await expect(trashPhoto(io, originalUrl, "a", actor, now)).rejects.toThrow("ETag");
  await io.write(url, buildTrash(url, photo, record), { create: true });
  const trash = pod.files.get(url);
  if (!trash) throw new Error("fixture");
  trash.etag = null;
  await expect(restorePhoto(io, url)).rejects.toThrow("ETag");
  await expect(purgePhoto(io, url)).rejects.toThrow("ETag");
  expect(pod.files.has(url)).toBe(true);
});
it("purges absent assets idempotently and refuses imported or mismatched binaries", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.write(url, buildTrash(url, photo, record), { create: true });
  await purgePhoto(io, url);
  const { thumbnailUrl: _, ...noThumb } = photo;
  await io.write(url, buildTrash(url, noThumb, record), { create: true });
  await purgePhoto(io, url);
  for (const [value, origin] of [
    [photo, `${storage}import.ttl`],
    [{ ...photo, contentUrl: "https://evil.example/a.jpg" }, originalUrl],
    [{ ...photo, contentUrl: `${storage}photos/originals/a.exe` }, originalUrl],
    [{ ...photo, thumbnailUrl: `${storage}photos/thumbs/b.webp` }, originalUrl],
  ] as const) {
    await io.write(url, buildTrash(url, value, { ...record, originalUrl: origin }), {
      create: true,
    });
    await expect(purgePhoto(io, url)).rejects.toThrow();
    const file = pod.files.get(url);
    await io.remove(url, file?.etag as string);
  }
});
it("surfaces binary HEAD/delete errors and retains trash for retry", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.write(url, buildTrash(url, photo, record), { create: true });
  pod.failures.set(`HEAD ${photo.contentUrl}`, 403);
  await expect(purgePhoto(io, url)).rejects.toMatchObject({ status: 403 });
  pod.failures.delete(`HEAD ${photo.contentUrl}`);
  pod.files.set(photo.contentUrl, { body: new Blob(), type: "image/jpeg", etag: null });
  await expect(purgePhoto(io, url)).rejects.toThrow("ETag");
  pod.files.delete(photo.contentUrl);
  pod.failures.set(`HEAD ${photo.contentUrl}`, 410);
  await purgePhoto(io, url);
});

it("refuses to purge a recovery copy while the source still exists or cannot be checked", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.savePhoto(originalUrl, photo, { create: true });
  await io.write(url, buildTrash(url, photo, record), { create: true });
  await expect(purgePhoto(io, url)).rejects.toThrow("original description exists");
  pod.failures.set(`GET ${originalUrl}`, 403);
  await expect(purgePhoto(io, url)).rejects.toMatchObject({ status: 403 });
  pod.failures.set(`GET ${originalUrl}`, 410);
  await purgePhoto(io, url);
});
