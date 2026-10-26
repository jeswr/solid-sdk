// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { expect, it, vi } from "vitest";
import { photoStorage } from "../../src/apps/photos/lib/model/io.js";
import { buildPhoto, PhotographDoc } from "../../src/apps/photos/lib/model/photograph.js";
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

it.each([
  "restore",
  "purge",
] as const)("fences a stale %s before it can change metadata or binaries", async (loser) => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.write(url, buildTrash(url, photo, record), { create: true });
  for (const binary of [photo.contentUrl, photo.thumbnailUrl])
    pod.files.set(binary, { body: new Blob(), type: "image/jpeg", etag: '"binary"' });
  let resume!: () => void;
  let arrived!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const write = io.write;
  vi.spyOn(io, "write").mockImplementationOnce(async (...args) => {
    arrived();
    await paused;
    return write(...args);
  });
  const losingOperation = loser === "restore" ? restorePhoto : purgePhoto;
  const winningOperation = loser === "restore" ? purgePhoto : restorePhoto;
  const outcome = expect(losingOperation(io, url)).rejects.toMatchObject({ status: 412 });
  await reached;
  await winningOperation(io, url);
  resume();
  await outcome;
  expect(pod.files.has(originalUrl)).toBe(loser === "purge");
  expect(pod.files.has(photo.contentUrl)).toBe(loser === "purge");
  expect(pod.files.has(photo.thumbnailUrl)).toBe(loser === "purge");
  expect(pod.files.has(url)).toBe(false);
});

it("blocks purge while restore owns the record and permits a create-only restore retry", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.write(url, buildTrash(url, photo, record), { create: true });
  pod.failures.set(`PUT ${originalUrl}`, 503);
  await expect(restorePhoto(io, url)).rejects.toMatchObject({ status: 503 });
  expect(parseTrash(url, (await io.read(url)).dataset).record.state).toBe("restoring");
  await expect(purgePhoto(io, url)).rejects.toThrow("restoring");
  pod.failures.delete(`PUT ${originalUrl}`);
  await restorePhoto(io, url);
  expect((await io.loadPhoto(originalUrl)).photo).toEqual(photo);
});

it.each([
  503, 412,
])("retries trash cleanup after a %s without rewriting the live photo", async (status) => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.write(url, buildTrash(url, photo, record), { create: true });
  pod.failures.set(`DELETE ${url}`, status);
  await expect(restorePhoto(io, url)).rejects.toMatchObject({ status });
  const restored = pod.files.get(originalUrl);
  const activity = parseTrash(url, (await io.read(url)).dataset).record.restoreActivity;
  expect(activity).toMatch(/^https:\/\/pod\.example\/photos\/\.trash\/a\.ttl#restore-/);
  expect((await io.loadPhoto(originalUrl)).photo).toEqual(photo);
  await expect(purgePhoto(io, url)).rejects.toThrow("restoring");
  pod.failures.delete(`DELETE ${url}`);
  // A new adapter must recover using persisted data alone.
  expect(await restorePhoto(photoStorage(pod.fetch, storage), url)).toBe(originalUrl);
  expect(pod.files.get(originalUrl)).toBe(restored);
  expect(pod.files.has(url)).toBe(false);
  expect(await trashPhoto(io, originalUrl, "a", actor, now)).toBe(url);
});

it("recovers after a lost creation response using the persisted restore receipt", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.write(url, buildTrash(url, photo, record), { create: true });
  const write = io.write;
  vi.spyOn(io, "write").mockImplementation(async (...args) => {
    const result = await write(...args);
    if (args[0] === originalUrl) throw new Error("Lost response");
    return result;
  });
  await expect(restorePhoto(io, url)).rejects.toThrow("Lost response");
  const restored = pod.files.get(originalUrl);
  const activity = parseTrash(url, (await io.read(url)).dataset).record.restoreActivity;
  const freshIo = photoStorage(pod.fetch, storage);
  pod.failures.set(`GET ${originalUrl}`, 403);
  await expect(restorePhoto(freshIo, url)).rejects.toMatchObject({ status: 403 });
  expect(pod.files.has(url)).toBe(true);
  expect(parseTrash(url, (await io.read(url)).dataset).record.restoreActivity).toBe(activity);
  pod.failures.delete(`GET ${originalUrl}`);
  expect(await restorePhoto(freshIo, url)).toBe(originalUrl);
  expect(pod.files.get(originalUrl)).toBe(restored);
  expect(pod.files.has(url)).toBe(false);
});

it.each([
  undefined,
  `${url}#another-restore`,
])("refuses an identical live photo with an unrelated restore receipt (%s)", async (restoreActivity) => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.write(url, buildTrash(url, photo, { ...record, state: "restoring" }), { create: true });
  const live = buildPhoto(originalUrl, photo);
  new TrashDoc(`${originalUrl}#it`, live, DataFactory).restoreActivity = restoreActivity;
  await io.write(originalUrl, live, { create: true });
  const existing = pod.files.get(originalUrl);
  await expect(restorePhoto(io, url)).rejects.toMatchObject({ status: 412 });
  expect(pod.files.get(originalUrl)).toBe(existing);
  expect(pod.files.has(url)).toBe(true);
});

it("persists purging after partial deletion, forbids restore, and permits purge retry", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.write(url, buildTrash(url, photo, record), { create: true });
  for (const binary of [photo.contentUrl, photo.thumbnailUrl])
    pod.files.set(binary, { body: new Blob(), type: "image/jpeg", etag: '"binary"' });
  pod.failures.set(`DELETE ${photo.thumbnailUrl}`, 503);
  await expect(purgePhoto(io, url)).rejects.toMatchObject({ status: 503 });
  expect(pod.files.has(photo.contentUrl)).toBe(false);
  expect(pod.files.has(photo.thumbnailUrl)).toBe(true);
  expect(parseTrash(url, (await io.read(url)).dataset).record.state).toBe("purging");
  await expect(restorePhoto(io, url)).rejects.toThrow("purging");
  expect(pod.files.has(originalUrl)).toBe(false);
  pod.failures.delete(`DELETE ${photo.thumbnailUrl}`);
  await purgePhoto(io, url);
  expect(pod.files.has(url)).toBe(false);
});

it("requires the claim write's ETag before any restore or purge side effects", async () => {
  const pod = mockPod();
  const io = photoStorage(pod.fetch, storage);
  await io.write(url, buildTrash(url, photo, record), { create: true });
  vi.spyOn(io, "write").mockResolvedValue({ etag: null });
  await expect(restorePhoto(io, url)).rejects.toThrow("ETag");
  await expect(purgePhoto(io, url)).rejects.toThrow("ETag");
  expect(pod.files.has(originalUrl)).toBe(false);
  expect(pod.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
});

it("round-trips claimed states and rejects unknown persisted states", () => {
  for (const state of ["restoring", "purging"] as const) {
    const claimed = { ...record, state };
    expect(parseTrash(url, buildTrash(url, photo, claimed))).toEqual({ photo, record: claimed });
  }
  const dataset = buildTrash(url, photo, record);
  const doc = new TrashDoc(`${url}#trash`, dataset, DataFactory);
  doc.state = "invalid";
  expect(() => parseTrash(url, dataset)).toThrow("Invalid trash state");
  const receipt = {
    ...record,
    state: "restoring" as const,
    restoreActivity: `${url}#restore-test`,
  };
  expect(parseTrash(url, buildTrash(url, photo, receipt))).toEqual({ photo, record: receipt });
});
