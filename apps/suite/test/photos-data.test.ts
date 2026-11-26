// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { scenes } from "../src/apps/photos/demo/images";
import { ensureSample } from "../src/apps/photos/demo/sample";
import {
  changeMembers,
  coverAlbum,
  createAlbum,
  deleteAlbum,
  listAlbums,
  orderAlbum,
  saveAlbum,
} from "../src/apps/photos/lib/data/albums";
import { preferenceStore, setFavourites } from "../src/apps/photos/lib/data/favourites";
import {
  dayGroups,
  listLibrary,
  saveKeywords,
  searchPhotos,
} from "../src/apps/photos/lib/data/library";
import { children, collect, requireEtag, statusOf } from "../src/apps/photos/lib/data/shared";
import { photoDataStorage } from "../src/apps/photos/lib/data/storage";
import {
  emptyTrash,
  listTrash,
  purgePhoto,
  restorePhoto,
  trashPhoto,
} from "../src/apps/photos/lib/data/trash";
import { uploadFiles } from "../src/apps/photos/lib/data/upload";
import {
  buildPhoto,
  buildTrash,
  type ImageEncoder,
  type Photo,
  PhotographDoc,
  photoStorage,
} from "../src/apps/photos/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

const ROOT = "https://alice.demo.pod/";
const NOW = "2026-10-29T12:00:00.000Z";
const photo: Photo = {
  name: "Canal",
  description: "Evening reflection",
  contentUrl: `${ROOT}photos/originals/one.png`,
  keywords: ["water"],
  exif: { pixelWidth: 160, pixelHeight: 100, dateTimeOriginal: NOW },
  created: NOW,
};
function binary(value: string, type: string) {
  return new Blob([Uint8Array.from(atob(value), (c) => c.charCodeAt(0))], { type });
}
const png = binary(scenes[0][0], "image/png");
const webp = binary(scenes[0][1], "image/webp");
const encoder: ImageEncoder = {
  dimensions: async () => ({ width: 160, height: 100 }),
  stripLocation: async (original) => original,
  thumbnail: async () => webp,
};
function setup() {
  const pod = createDemoPod({ root: ROOT });
  const failures = new Map<string, number | "network">();
  const writes: { url: string; headers: Headers }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "PUT" || method === "DELETE")
      writes.push({ url, headers: new Headers(init?.headers) });
    const failure = failures.get(`${method} ${url}`);
    if (failure === "network") throw new Error("Network unavailable");
    if (failure) return new Response(null, { status: failure });
    return pod.fetch(input, init);
  };
  return { pod, failures, writes, fetch, io: photoDataStorage(fetch, ROOT) };
}
async function upload(io: ReturnType<typeof photoDataStorage>, id = "one", stripLocation = true) {
  const outcomes = await uploadFiles(io, [{ name: `${id}.png`, original: png }], {
    encoder,
    stripLocation,
    now: NOW,
    id: () => id,
  });
  const result = outcomes[0];
  if (!result?.ok) throw result && !result.ok ? result.error : new Error("Fixture upload failed");
  return result.url;
}

describe("Photos library and shared reads", () => {
  it("lists real pod metadata, tombstones, connector subjects and isolated malformed files", async () => {
    const { io, pod, failures } = setup();
    expect((await listLibrary(io)).items).toEqual([]);
    await upload(io);
    const url = `${io.root}items/connector.ttl`;
    const store = buildPhoto(url, photo);
    const doc = new PhotographDoc(`${url}#it`, store, DataFactory);
    doc.types.delete("http://schema.org/Photograph");
    doc.types.add("http://schema.org/ImageObject");
    const second = new PhotographDoc(`${url}#second`, store, DataFactory);
    second.mark();
    second.contentUrl = photo.contentUrl;
    second.name = "Older";
    await io.write(url, store, { create: true });
    const undatedUrl = `${io.root}items/undated.ttl`;
    const singleImported = new Store();
    const importedDoc = new PhotographDoc(`${undatedUrl}#imported`, singleImported, DataFactory);
    importedDoc.mark();
    importedDoc.contentUrl = photo.contentUrl;
    importedDoc.name = "Undated";
    await io.write(undatedUrl, singleImported, { create: true });
    await io.write(`${io.root}items/tombstone.ttl`, new Store(), { create: true });
    await pod.fetch(`${io.root}items/broken.ttl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "this is not RDF",
    });
    const library = await listLibrary(io);
    expect(library.items).toHaveLength(4);
    const imported = library.items.find((item) => item.ref === `${url}#it`);
    if (!imported) throw new Error("Missing connector photo");
    await expect(saveKeywords(io, imported, ["keep others"])).rejects.toThrow("read-only");
    expect(library.failures).toHaveLength(1);
    expect(library.groups.map((group) => group.key)).toEqual(["2026-10-29", "undated"]);
    expect(library.groups[0]?.monthLabel).toBe("October 2026");
    expect(library.groups[1]?.monthLabel).toBe("Undated");
    const album = { ...(await createAlbum(io, "Ghent trip", NOW)), members: [`${url}#it`] };
    expect(searchPhotos(library.items, [album], "October water")).toHaveLength(1);
    expect(searchPhotos(library.items, [album], "2026-10")).toHaveLength(2);
    expect(searchPhotos(library.items, [album], "Ghent trip")).toHaveLength(1);
    expect(searchPhotos(library.items, [], "undated")).toHaveLength(2);
    expect(searchPhotos(library.items, [], "")).toHaveLength(4);
    expect(searchPhotos(library.items, [], "missing")).toEqual([]);
    const own = library.items.find((item) => item.name === "one.png");
    expect(own).toBeDefined();
    if (!own) throw new Error("Missing own photo");
    await saveKeywords(io, own, ["new", "new"]);
    expect((await io.loadPhoto(own.url)).photo?.keywords).toEqual(["new"]);
    await expect(saveKeywords(io, own, ["stale"])).rejects.toMatchObject({ status: 412 });
    await expect(saveKeywords(io, { ...own, ref: `${url}#other` }, [])).rejects.toThrow(
      "read-only",
    );
    await expect(saveKeywords(io, { ...own, etag: null }, [])).rejects.toThrow("ETag");
    failures.set(`GET ${io.root}items/`, 403);
    await expect(listLibrary(io)).rejects.toMatchObject({ status: 403 });
  });
  it("bounds concurrency, preserves order and validates each listed URL before reading it", async () => {
    const { io, fetch } = setup();
    let active = 0;
    let max = 0;
    const urls = Array.from({ length: 20 }, (_, index) => `${index}`);
    const values = await collect(urls, async (value) => {
      active++;
      max = Math.max(max, active);
      await Promise.resolve();
      active--;
      if (value === "7") throw new Error("Bad item");
      return [value];
    });
    expect(max).toBe(6);
    expect(values.items).toEqual(urls.filter((value) => value !== "7"));
    expect(values.failures[0]?.url).toBe("7");
    expect(await collect([], async () => [])).toEqual({ items: [], failures: [] });
    const base = `${io.root}items/`;
    // Exercise the listing trust boundary independently of the demo server's
    // well-formed ldp:contains output. No image/document fetches are mocked.
    const malicious = {
      ...io,
      list: async () => [
        base,
        `${base}ok.ttl`,
        `${base}nested/`,
        `${base}bad.ttl?q=1`,
        `${base}bad.ttl#it`,
        "not a URL",
        "https://evil.test/photos/items/a.ttl",
        "https://user@alice.demo.pod/photos/items/a.ttl",
        "https://user:password@alice.demo.pod/photos/items/b.ttl",
        `${ROOT}photos/elsewhere.ttl`,
      ],
    };
    expect(await children(malicious, "items/")).toEqual([`${base}ok.ttl`]);
    expect(statusOf(null)).toBeUndefined();
    expect(statusOf("failure")).toBeUndefined();
    expect(statusOf({})).toBeUndefined();
    expect(statusOf({ status: 412 })).toBe(412);
    for (const value of [null, "", 'W/"weak"']) expect(() => requireEtag(value)).toThrow("ETag");
    expect(requireEtag('"strong"')).toBe('"strong"');
    expect(dayGroups([])).toEqual([]);
    expect(await listLibrary(photoStorage(fetch, ROOT))).toEqual({
      items: [],
      failures: [],
      groups: [],
    });
  });
});

describe("Photos album operations", () => {
  it("clears a removed explicit cover on save and reload, including the final member", async () => {
    const { io } = setup();
    const refs = [`${io.root}items/one.ttl#it`, `${io.root}items/two.ttl#it`];
    const album = await createAlbum(io, "Covers", NOW, refs);
    await saveAlbum(io, coverAlbum(album, refs[0] as string));
    for (const ref of refs) {
      const loaded = (await listAlbums(io)).items[0];
      if (!loaded) throw new Error("Missing album");
      const covered = coverAlbum(loaded, ref);
      expect(changeMembers(covered, [], false).coverUrl).toBe(ref);
      await saveAlbum(io, changeMembers(covered, [ref], false));
      const reloaded = (await listAlbums(io)).items[0];
      expect(reloaded?.coverUrl).toBeUndefined();
      expect(reloaded?.members).toEqual(ref === refs[0] ? [refs[1]] : []);
    }
  });
  it("creates collision-safe names and persists rename, membership, order, cover and deletion", async () => {
    const { io, failures, writes } = setup();
    expect((await listAlbums(io)).items).toEqual([]);
    const first = await createAlbum(io, "  Ghent trip  ", NOW);
    const second = await createAlbum(io, "Ghent trip", NOW);
    expect(second.url).toContain("ghent-trip-2.ttl");
    expect((await createAlbum(io, "🌿", NOW)).url).toContain("album.ttl");
    await expect(createAlbum(io, " ", NOW)).rejects.toThrow("name");
    const refs = [`${io.root}items/one.ttl#it`, `${io.root}items/two.ttl#it`] as const;
    const populated = changeMembers(first, [refs[0], refs[1], refs[0]], true);
    expect(populated.members).toEqual(refs);
    expect(changeMembers(populated, [refs[0]], false).members).toEqual([refs[1]]);
    const reordered = orderAlbum(populated, [...refs].reverse());
    const covered = coverAlbum({ ...reordered, name: "A trip" }, refs[0]);
    await saveAlbum(io, covered);
    const loaded = await io.loadAlbum(first.url);
    expect(loaded.album).toMatchObject({
      name: "A trip",
      members: [...refs].reverse(),
      coverUrl: refs[0],
    });
    expect(covered.members).toEqual([...refs].reverse());
    expect(() => coverAlbum(populated, `${ROOT}unknown`)).toThrow("belong");
    await expect(saveAlbum(io, { ...first, name: " " })).rejects.toThrow("name");
    await expect(saveAlbum(io, { ...first, etag: null })).rejects.toThrow("ETag");
    await expect(saveAlbum(io, first)).rejects.toMatchObject({ status: 412 });
    await io.write(`${io.root}albums/other.ttl`, new Store(), { create: true });
    await io.write(`${io.root}albums/broken.ttl`, new Store(), { create: true });
    failures.set(`GET ${io.root}albums/broken.ttl`, 500);
    const listing = await listAlbums(io);
    expect(listing.items).toHaveLength(3);
    expect(listing.failures).toHaveLength(1);
    await deleteAlbum(io, { ...first, etag: loaded.etag });
    expect((await listAlbums(io)).items).toHaveLength(2);
    await expect(deleteAlbum(io, { ...second, etag: null })).rejects.toThrow("ETag");
    failures.set(`PUT ${io.root}albums/fail.ttl`, 500);
    await expect(createAlbum(io, "Fail", NOW)).rejects.toMatchObject({ status: 500 });
    expect(
      writes.every(
        ({ headers }) => headers.has("if-match") || headers.get("if-none-match") === "*",
      ),
    ).toBe(true);
  });
});

describe("Photos preference adapter", () => {
  it("creates, deduplicates and conditionally updates favourites and isolates accounts", async () => {
    const { io, fetch, pod, failures, writes } = setup();
    const store = preferenceStore(fetch, ROOT);
    expect(await store.read()).toEqual({ favourites: [], etag: null, exists: false });
    await io.ensureContainers([""]);
    const ref = `${io.root}items/one.ttl#it`;
    await setFavourites(store, [ref, ref], true);
    expect((await store.read()).favourites).toEqual([ref]);
    const stale = await store.read();
    await setFavourites(store, [ref], false);
    expect((await store.read()).favourites).toEqual([]);
    await expect(store.write(stale)).rejects.toMatchObject({ status: 412 });
    await expect(store.write({ ...stale, etag: null })).rejects.toThrow("ETag");
    const second = createDemoPod({ root: "https://bob.demo.pod/" });
    expect(
      (await preferenceStore(second.fetch, "https://bob.demo.pod/").read()).favourites,
    ).toEqual([]);
    const prefUrl = `${io.root}preferences.json`;
    await pod.fetch(prefUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favourites: [ref, ref] }),
    });
    expect((await store.read()).favourites).toEqual([ref]);
    for (const value of [
      null,
      1,
      {},
      { favourites: "bad" },
      { favourites: [1] },
      { favourites: ["file:///private"] },
    ]) {
      await pod.fetch(prefUrl, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
      await expect(store.read()).rejects.toThrow("Invalid photo preferences");
    }
    failures.set(`GET ${prefUrl}`, 500);
    await expect(store.read()).rejects.toMatchObject({ status: 500 });
    failures.set(`PUT ${prefUrl}`, 500);
    await expect(store.write({ favourites: [], etag: null, exists: false })).rejects.toMatchObject({
      status: 500,
    });
    expect(
      writes.every(({ headers }) => headers.has("if-match") || headers.has("if-none-match")),
    ).toBe(true);
  });
});

describe("Photos trash adapter", () => {
  it("round trips stable photo subjects, keeps album/favourite references, and empties trash with failures", async () => {
    const { io, fetch } = setup();
    expect(await listTrash(io)).toEqual({ items: [], failures: [] });
    const url = await upload(io);
    const store = preferenceStore(fetch, ROOT);
    await setFavourites(store, [`${url}#it`], true);
    const album = await createAlbum(io, "Garden", NOW);
    await saveAlbum(io, changeMembers(album, [`${url}#it`], true));
    const moved = await trashPhoto(io, url, "trash-one", `${ROOT}profile/card#me`, NOW);
    expect(moved.ok).toBe(true);
    if (!moved.ok) throw moved.error;
    expect((await listLibrary(io)).items).toHaveLength(0);
    expect((await listTrash(io)).items).toHaveLength(1);
    const restored = await restorePhoto(io, moved.value);
    expect(restored).toEqual({ ok: true, value: url });
    expect((await listLibrary(io)).items).toHaveLength(1);
    expect((await store.read()).favourites).toEqual([`${url}#it`]);
    expect((await io.loadAlbum(album.url)).album?.members).toEqual([`${url}#it`]);
    const again = await trashPhoto(io, url, "trash-again", `${ROOT}profile/card#me`, NOW);
    expect(again.ok).toBe(true);
    const other = `${io.root}.trash/imported.ttl`;
    await io.write(
      other,
      buildTrash(other, photo, {
        originalUrl: `${ROOT}photos/imported.ttl`,
        actor: `${ROOT}profile/card#me`,
        trashedAt: NOW,
      }),
      { create: true },
    );
    await io.write(`${io.root}.trash/malformed.ttl`, new Store(), { create: true });
    const emptied = await emptyTrash(io);
    expect(emptied.purged).toHaveLength(1);
    expect(emptied.failures).toHaveLength(2);
    expect((await io.loadPhotos(url)).photos).toEqual([]);
    expect(await io.list(`${io.root}originals/`)).toEqual([]);
    expect((await purgePhoto(io, `${io.root}.trash/missing.ttl`)).ok).toBe(false);
    expect((await restorePhoto(io, `${io.root}.trash/missing.ttl`)).ok).toBe(false);
    expect((await trashPhoto(io, url, "not-live", `${ROOT}profile/card#me`, NOW)).ok).toBe(false);
  });
});

describe("Photos upload orchestration", () => {
  it("prepares without DOM, reports progress per file and continues after an invalid file", async () => {
    const { io, writes } = setup();
    const progress: number[] = [];
    let id = 0;
    const result = await uploadFiles(
      io,
      [
        { name: "invalid", original: new Blob(["bad"], { type: "text/plain" }) },
        { name: "good.png", original: png },
      ],
      {
        encoder,
        now: NOW,
        stripLocation: true,
        id: () => `upload-${++id}`,
        onProgress: (_index, percent) => progress.push(percent),
      },
    );
    expect(result.map((value) => value.ok)).toEqual([false, true]);
    expect(progress).toEqual([0, 0, 30, 100]);
    expect((await listLibrary(io)).items).toHaveLength(1);
    expect(
      await uploadFiles(io, [], { encoder, now: NOW, stripLocation: false, id: () => "empty" }),
    ).toEqual([]);
    expect(writes.every(({ headers }) => headers.get("if-none-match") === "*")).toBe(true);
  });
  it("cleans unpublished partial binaries, preserves collisions, and keeps recoverable state when cleanup fails", async () => {
    const { io, failures, pod } = setup();
    failures.set(`PUT ${io.root}thumbs/thumb-fail.webp`, 500);
    expect(
      (
        await uploadFiles(io, [{ name: "a.png", original: png }], {
          encoder,
          now: NOW,
          stripLocation: false,
          id: () => "thumb-fail",
        })
      )[0]?.ok,
    ).toBe(false);
    expect((await pod.fetch(`${io.root}originals/thumb-fail.png`)).status).toBe(404);
    failures.set(`PUT ${io.root}items/meta-fail.ttl`, 500);
    expect(
      (
        await uploadFiles(io, [{ name: "b.png", original: png }], {
          encoder,
          now: NOW,
          stripLocation: false,
          id: () => "meta-fail",
        })
      )[0]?.ok,
    ).toBe(false);
    expect((await pod.fetch(`${io.root}thumbs/meta-fail.webp`)).status).toBe(404);
    await upload(io);
    expect(
      (
        await uploadFiles(io, [{ name: "collision.png", original: png }], {
          encoder,
          now: NOW,
          stripLocation: false,
          id: () => "one",
        })
      )[0]?.ok,
    ).toBe(false);
    expect((await io.loadPhoto(`${io.root}items/one.ttl`)).photo?.name).toBe("one.png");
    failures.set(`PUT ${io.root}thumbs/no-clean.webp`, 500);
    failures.set(`GET ${io.root}items/no-clean.ttl`, "network");
    expect(
      (
        await uploadFiles(io, [{ name: "c.png", original: png }], {
          encoder,
          now: NOW,
          stripLocation: false,
          id: () => "no-clean",
        })
      )[0]?.ok,
    ).toBe(false);
    expect((await pod.fetch(`${io.root}originals/no-clean.png`)).status).toBe(200);
    failures.set(`PUT ${io.root}items/kept.ttl`, 500);
    await io.savePhoto(`${io.root}items/kept.ttl`, photo, { create: true }).catch(() => {});
    failures.delete(`PUT ${io.root}items/kept.ttl`);
    // An unrelated pre-existing metadata document means cleanup must preserve
    // binaries even after another upload stage fails.
    await io.savePhoto(`${io.root}items/kept.ttl`, photo, { create: true });
    failures.set(`PUT ${io.root}thumbs/kept.webp`, 500);
    expect(
      (
        await uploadFiles(io, [{ name: "d.png", original: png }], {
          encoder,
          now: NOW,
          stripLocation: false,
          id: () => "kept",
        })
      )[0]?.ok,
    ).toBe(false);
    expect((await pod.fetch(`${io.root}originals/kept.png`)).status).toBe(200);
  });
});

it("seeds a small realistic demo through the adapters once and preserves a user's existing library", async () => {
  const { pod, io, fetch } = setup();
  const session: PodSession = {
    mode: "demo",
    webId: `${ROOT}profile/card#me`,
    displayName: "Alice",
    storageUrl: ROOT,
    fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await Promise.all([ensureSample(session), ensureSample(session)]);
  const library = await listLibrary(io);
  expect(library.items).toHaveLength(13);
  expect(library.items.find((item) => item.kind === "video")).toMatchObject({
    name: "Lake breeze",
    durationSeconds: 62.5,
  });
  expect((await listAlbums(io)).items.map((album) => album.name).sort()).toEqual([
    "Garden",
    "Ghent trip",
  ]);
  expect((await preferenceStore(fetch, ROOT).read()).favourites).toHaveLength(2);
  expect(library.items.some((item) => item.exif.location)).toBe(true);
  await ensureSample({ ...session });
  expect((await listLibrary(io)).items).toHaveLength(13);
  const total = pod
    .snapshot()
    .resources.reduce((sum, [, resource]) => sum + resource.body.byteLength, 0);
  expect(total).toBeLessThan(200_000);
});

// Responses without a usable validator cannot authorize deletion of a partial binary.
it("does not delete binary writes without ownership validators or after an unknown creation failure", async () => {
  const pod = createDemoPod({ root: ROOT });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await pod.fetch(input, init);
    if (init?.method === "PUT" && String(input).includes("originals/")) {
      if (String(input).includes("weak")) response.headers.set("etag", 'W/"weak"');
      else response.headers.delete("etag");
    }
    if (init?.method === "PUT" && String(input).endsWith(".webp"))
      return new Response(null, { status: 500 });
    return response;
  };
  const io = photoDataStorage(fetch, ROOT);
  for (const id of ["missing-validator", "weak-validator"]) {
    const result = await uploadFiles(io, [{ name: "photo.png", original: png }], {
      encoder,
      stripLocation: false,
      now: NOW,
      id: () => id,
    });
    expect(result[0]?.ok).toBe(false);
    expect((await pod.fetch(`${io.root}originals/${id}.png`)).status).toBe(200);
  }
  const another = setup();
  await another.pod.fetch(`${another.io.root}originals/pre-existing.png`, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: png,
  });
  another.failures.set(`PUT ${another.io.root}originals/pre-existing.png`, 500);
  const result = await uploadFiles(another.io, [{ name: "photo.png", original: png }], {
    encoder,
    stripLocation: false,
    now: NOW,
    id: () => "pre-existing",
  });
  expect(result[0]?.ok).toBe(false);
  expect((await another.pod.fetch(`${another.io.root}originals/pre-existing.png`)).status).toBe(
    200,
  );
});
