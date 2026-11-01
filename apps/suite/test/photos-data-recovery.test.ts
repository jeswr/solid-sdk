// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { scenes } from "../src/apps/photos/demo/images";
import { browserEncoder, LocationStripError } from "../src/apps/photos/lib/browser/encoder";
import { createAlbum } from "../src/apps/photos/lib/data/albums";
import { createKeywordWriter, listLibrary } from "../src/apps/photos/lib/data/library";
import { photoDataStorage } from "../src/apps/photos/lib/data/storage";
import { listTrash, purgePhoto, restorePhoto, trashPhoto } from "../src/apps/photos/lib/data/trash";
import { uploadFiles } from "../src/apps/photos/lib/data/upload";
import { buildTrash, type ImageEncoder, RestoreReceipt } from "../src/apps/photos/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { animatedPng } from "./photos/animated-png";

const ROOT = "https://recovery.demo.pod/";
const NOW = "2026-11-01T12:00:00.000Z";
const ACTOR = `${ROOT}profile#me`;
const png = new Blob([Uint8Array.from(atob(scenes[0][0]), (c) => c.charCodeAt(0))], {
  type: "image/png",
});
const encoder: ImageEncoder = {
  dimensions: async () => ({ width: 160, height: 100 }),
  thumbnail: async () => new Blob(["pixels"], { type: "image/webp" }),
  stripLocation: async (blob) => blob,
};
function setup() {
  const pod = createDemoPod({ root: ROOT });
  const fail = new Map<string, number>();
  const lost = new Set<string>();
  const noEtag = new Set<string>();
  let afterPut: ((url: string) => Promise<void>) | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const key = `${init?.method ?? "GET"} ${url}`;
    const status = fail.get(key);
    if (status) return new Response(null, { status });
    const response = await pod.fetch(input, init);
    if (init?.method === "PUT") await afterPut?.(url);
    if (noEtag.has(key)) response.headers.delete("etag");
    if (lost.has(key)) throw new Error("Lost response");
    return response;
  };
  const io = photoDataStorage(fetch, ROOT);
  const upload = (id = "photo", now = NOW, changes = {}) =>
    uploadFiles(io, [{ name: "photo.png", original: png, ...changes }], {
      encoder,
      stripLocation: true,
      now,
      id: () => id,
    });
  return {
    io,
    pod,
    fail,
    lost,
    noEtag,
    upload,
    afterPut: (callback: typeof afterPut) => {
      afterPut = callback;
    },
  };
}
async function photo(s: ReturnType<typeof setup>) {
  expect((await s.upload())[0]?.ok).toBe(true);
  const value = (await listLibrary(s.io)).items[0];
  if (!value) throw new Error("Missing fixture");
  return value;
}

describe("Photos recovery regressions", () => {
  it("refuses animated PNG stripping before any write, and preserves every original byte when stripping is off", async () => {
    const s = setup();
    const original = animatedPng();
    const options = {
      encoder: { ...encoder, stripLocation: browserEncoder.stripLocation },
      stripLocation: true,
      now: NOW,
      id: () => "animation",
    };
    const file = { name: "animation.png", original };
    const rejected = (await uploadFiles(s.io, [file], options))[0];
    expect(rejected).toMatchObject({ ok: false, error: expect.any(LocationStripError) });
    expect(s.pod.snapshot().resources).toHaveLength(0);
    expect((await uploadFiles(s.io, [file], { ...options, stripLocation: false }))[0]?.ok).toBe(
      true,
    );
    expect(await (await s.pod.fetch(`${s.io.root}originals/animation.png`)).arrayBuffer()).toEqual(
      await original.arrayBuffer(),
    );
  });
  it.each([
    "originals/photo.png",
    "thumbs/photo.webp",
  ])("reconciles a lost response for %s against cached bytes and a fresh strong ETag", async (path) => {
    const s = setup();
    const url = `${s.io.root}${path}`;
    s.lost.add(`PUT ${url}`);
    expect((await s.upload())[0]?.ok).toBe(false);
    const before = await s.pod.fetch(url);
    expect(before.status).toBe(200);
    const bytes = await before.arrayBuffer();
    s.lost.clear();
    expect((await s.upload("photo", "2026-11-02T12:00:00Z"))[0]?.ok).toBe(true);
    const saved = await s.pod.fetch(url);
    expect(await saved.arrayBuffer()).toEqual(bytes);
    expect(saved.headers.get("etag")).toBe(before.headers.get("etag"));
    expect((await listLibrary(s.io)).items).toHaveLength(1);
    expect((await s.io.loadPhoto(`${s.io.root}items/photo.ttl`)).photo?.created).toBe(NOW);
    expect(s.io.createdBinaries.size).toBe(0);
    expect(s.io.uploads.size).toBe(0);
  });
  it("can retry an ambiguous write that never committed or whose binary was removed", async () => {
    const s = setup();
    const url = `${s.io.root}originals/photo.png`;
    s.lost.add(`PUT ${url}`);
    expect((await s.upload())[0]?.ok).toBe(false);
    await s.pod.fetch(url, { method: "DELETE" });
    s.lost.clear();
    expect((await s.upload())[0]?.ok).toBe(true);
  });
  it("retains ambiguous writes across failed reads and refuses missing validators or different bytes", async () => {
    for (const scenario of ["read-failure", "missing-etag", "length", "pixels"]) {
      const s = setup();
      const url = `${s.io.root}originals/photo.png`;
      s.lost.add(`PUT ${url}`);
      expect((await s.upload())[0]?.ok).toBe(false);
      s.lost.clear();
      const bytes = new Uint8Array(await (await s.pod.fetch(url)).arrayBuffer());
      if (scenario === "read-failure") s.fail.set(`GET ${url}`, 500);
      if (scenario === "missing-etag") s.noEtag.add(`GET ${url}`);
      if (scenario === "length" || scenario === "pixels") {
        bytes[0] = (bytes[0] as number) ^ 1;
        await s.pod.fetch(url, {
          method: "PUT",
          body: scenario === "length" ? bytes.slice(1) : bytes,
        });
      }
      const result = (await s.upload())[0];
      expect(result?.ok).toBe(false);
      if (scenario === "length" || scenario === "pixels")
        expect(result).toMatchObject({ error: { status: 412 } });
      expect((await s.pod.fetch(url)).status).toBe(200);
      expect((await s.pod.fetch(`${s.io.root}items/photo.ttl`)).status).toBe(404);
      if (scenario === "read-failure" || scenario === "missing-etag") {
        s.fail.clear();
        s.noEtag.clear();
        expect((await s.upload())[0]?.ok).toBe(true);
      }
    }
  });
  it("creates selected album members atomically even when PUT omits its ETag", async () => {
    const s = setup();
    const url = `${s.io.root}albums/populated.ttl`;
    s.noEtag.add(`PUT ${url}`);
    const refs = [`${s.io.root}items/one.ttl#it`, `${s.io.root}items/two.ttl#it`];
    const album = await createAlbum(s.io, "Populated", NOW, [...refs, refs[0] as string]);
    expect(album.etag).toBeNull();
    expect((await s.io.loadAlbum(url)).album?.members).toEqual(refs);
    expect(await s.io.list(`${s.io.root}albums/`)).toEqual([url]);
  });
  it("propagates this client's successful keyword revisions while rejecting external edits", async () => {
    const s = setup();
    const original = await photo(s);
    const write = createKeywordWriter(s.io);
    const first = await write(original, ["garden"]);
    const second = await write(original, ["garden", "rose", "rose"]);
    expect(second.etag).not.toBe(first.etag);
    expect((await s.io.loadPhoto(original.url)).photo?.keywords).toEqual(["garden", "rose"]);
    const external = await s.io.savePhoto(
      original.url,
      { ...second, name: "Elsewhere" },
      { etag: second.etag as string },
    );
    await expect(write(original, ["stale"])).rejects.toMatchObject({ status: 412 });
    expect((await s.io.loadPhoto(original.url)).photo?.name).toBe("Elsewhere");
    await write({ ...second, name: "Elsewhere", etag: external.etag }, ["retry"]);
  });
  it("reads back missing keyword PUT validators only for an unchanged saved document", async () => {
    const s = setup();
    const original = await photo(s);
    s.noEtag.add(`PUT ${original.url}`);
    const write = createKeywordWriter(s.io);
    await write(original, ["one"]);
    await write(original, ["one", "two"]);
    expect((await s.io.loadPhoto(original.url)).photo?.keywords).toEqual(["one", "two"]);
    for (const missing of [false, true]) {
      const current = (await listLibrary(s.io)).items[0];
      if (!current) throw new Error("Missing fixture");
      s.afterPut(async (url) => {
        if (url !== original.url) return;
        s.afterPut(undefined);
        if (missing)
          await s.io.write(url, new Store(), { etag: (await s.io.read(url)).etag as string });
        else
          await s.io.savePhoto(
            url,
            { ...current, name: "Concurrent edit" },
            { etag: (await s.io.read(url)).etag as string },
          );
      });
      await expect(createKeywordWriter(s.io)(current, ["conflict"])).rejects.toMatchObject({
        status: 412,
      });
    }
  });
  it("does not use missing read validators after a keyword save", async () => {
    const s = setup();
    const original = await photo(s);
    s.noEtag.add(`PUT ${original.url}`);
    s.afterPut(async (url) => {
      if (url === original.url) s.noEtag.add(`GET ${original.url}`);
    });
    await expect(createKeywordWriter(s.io)(original, ["one"])).rejects.toThrow("ETag");
  });
  it("reuses a trash operation after a failed tombstone and failed cleanup, leaving one restorable record", async () => {
    const s = setup();
    const original = await photo(s);
    const copy = `${s.io.root}.trash/move.ttl`;
    s.fail.set(`PUT ${original.url}`, 500);
    expect((await trashPhoto(s.io, original.url, "move", ACTOR, NOW)).ok).toBe(false);
    s.fail.delete(`PUT ${original.url}`);
    s.fail.set(`DELETE ${copy}`, 500);
    expect((await trashPhoto(s.io, original.url, "move", ACTOR, NOW)).ok).toBe(false);
    expect((await listTrash(s.io)).items).toHaveLength(1);
    s.fail.clear();
    expect(await trashPhoto(s.io, original.url, "move", ACTOR, NOW)).toEqual({
      ok: true,
      value: copy,
    });
    expect((await listTrash(s.io)).items).toHaveLength(1);
    expect((await restorePhoto(s.io, copy)).ok).toBe(true);
    expect((await trashPhoto(s.io, original.url, "again", ACTOR, NOW)).ok).toBe(true);
    expect((await purgePhoto(s.io, `${s.io.root}.trash/again.ttl`)).ok).toBe(true);
  });
  it("recognizes a committed tombstone whose response was lost", async () => {
    const s = setup();
    const original = await photo(s);
    s.lost.add(`PUT ${original.url}`);
    expect((await trashPhoto(s.io, original.url, "move", ACTOR, NOW)).ok).toBe(false);
    s.lost.clear();
    expect((await trashPhoto(s.io, original.url, "move", ACTOR, NOW)).ok).toBe(true);
    expect((await restorePhoto(s.io, `${s.io.root}.trash/move.ttl`)).ok).toBe(true);
  });
  it("fences unrelated, changed and claimed recovery records", async () => {
    for (const scenario of ["actor", "url", "state", "changed", "tombstone", "legacy"]) {
      const s = setup();
      const original = await photo(s);
      const copy = `${s.io.root}.trash/move.ttl`;
      await s.io.ensureContainers([".trash/"]);
      await s.io.write(
        copy,
        buildTrash(copy, original, {
          originalUrl: scenario === "url" ? `${s.io.root}items/other.ttl` : original.url,
          actor: scenario === "actor" ? `${ROOT}other` : ACTOR,
          trashedAt: NOW,
          ...(scenario === "state" ? { state: "restoring" as const } : {}),
          ...(scenario === "legacy" ? {} : { restoreActivity: `${copy}#receipt` }),
        }),
        { create: true },
      );
      if (scenario === "changed")
        await s.io.savePhoto(
          original.url,
          { ...original, name: "Changed" },
          { etag: original.etag as string },
        );
      if (scenario === "tombstone" || scenario === "legacy") {
        const dataset = new Store();
        new RestoreReceipt(`${original.url}#it`, dataset, DataFactory).restoreActivity =
          `${copy}#other`;
        await s.io.write(original.url, dataset, { etag: original.etag as string });
      }
      const outcome = await trashPhoto(s.io, original.url, "move", ACTOR, NOW);
      expect(outcome).toMatchObject({ ok: false, error: { status: 412 } });
      expect((await listTrash(s.io)).items).toHaveLength(1);
    }
    const s = setup();
    s.fail.set(`GET ${s.io.root}.trash/move.ttl`, 500);
    expect(await trashPhoto(s.io, `${s.io.root}items/photo.ttl`, "move", ACTOR, NOW)).toMatchObject(
      { ok: false, error: { status: 500 } },
    );
    expect((await trashPhoto(s.io, `${s.io.root}items/photo.ttl`, "../bad", ACTOR, NOW)).ok).toBe(
      false,
    );
  });
  it("resumes retained upload binaries using ownership validators and keeps the original timestamp", async () => {
    const s = setup();
    s.fail.set(`PUT ${s.io.root}thumbs/photo.webp`, 500);
    s.fail.set(`DELETE ${s.io.root}originals/photo.png`, 500);
    expect((await s.upload())[0]?.ok).toBe(false);
    for (const changes of [
      { original: new Blob(["other"], { type: "image/png" }) },
      { name: "renamed" },
    ])
      expect((await s.upload("photo", NOW, changes))[0]?.ok).toBe(false);
    expect(
      (
        await uploadFiles(s.io, [{ name: "photo.png", original: png }], {
          encoder,
          stripLocation: false,
          now: NOW,
          id: () => "photo",
        })
      )[0]?.ok,
    ).toBe(false);
    s.fail.clear();
    expect((await s.upload("photo", "2026-11-02T12:00:00Z"))[0]).toMatchObject({ ok: true });
    expect((await s.io.loadPhoto(`${s.io.root}items/photo.ttl`)).photo?.created).toBe(NOW);
    expect(s.io.createdBinaries.size).toBe(0);
    expect(s.io.uploads.size).toBe(0);
  });
  it("resumes after cleanup deleted only the original and when a retained binary disappeared", async () => {
    const s = setup();
    s.fail.set(`PUT ${s.io.root}items/photo.ttl`, 500);
    s.fail.set(`DELETE ${s.io.root}thumbs/photo.webp`, 500);
    expect((await s.upload())[0]?.ok).toBe(false);
    const thumb = `${s.io.root}thumbs/photo.webp`;
    await s.pod.fetch(thumb, { method: "DELETE" });
    s.fail.clear();
    expect((await s.upload())[0]?.ok).toBe(true);
  });
  it("never overwrites or deletes a partial binary changed by another client", async () => {
    const s = setup();
    s.fail.set(`PUT ${s.io.root}thumbs/photo.webp`, 500);
    s.fail.set(`DELETE ${s.io.root}originals/photo.png`, 500);
    expect((await s.upload())[0]?.ok).toBe(false);
    const url = `${s.io.root}originals/photo.png`;
    await s.pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: "replacement",
    });
    s.fail.clear();
    expect((await s.upload())[0]).toMatchObject({ ok: false, error: { status: 412 } });
    expect(await (await s.pod.fetch(url)).text()).toBe("replacement");
    expect(await s.io.ownsBinary(url)).toBe(false);
    s.io.createdBinaries.delete(url);
    expect(await s.io.ownsBinary(url)).toBe(false);
  });
  it("retains partial uploads when a validator check fails", async () => {
    const s = setup();
    const original = `${s.io.root}originals/photo.png`;
    s.fail.set(`PUT ${s.io.root}thumbs/photo.webp`, 500);
    s.fail.set(`GET ${s.io.root}items/photo.ttl`, 500);
    expect((await s.upload())[0]?.ok).toBe(false);
    s.fail.set(`HEAD ${original}`, 500);
    expect((await s.upload())[0]).toMatchObject({ ok: false, error: { status: 500 } });
    s.fail.clear();
    expect((await s.upload())[0]?.ok).toBe(true);
  });
  it("recognizes a completed metadata write, immediately or on retry after an unreadable response", async () => {
    for (const unreadable of [false, true]) {
      const s = setup();
      const metadata = `${s.io.root}items/photo.ttl`;
      s.lost.add(`PUT ${metadata}`);
      if (unreadable) s.fail.set(`GET ${metadata}`, 500);
      const first = await s.upload();
      expect(first[0]?.ok).toBe(!unreadable);
      if (unreadable) {
        s.lost.clear();
        s.fail.clear();
        expect((await s.upload())[0]?.ok).toBe(true);
      }
      expect((await listLibrary(s.io)).items).toHaveLength(1);
      expect(s.io.createdBinaries.size).toBe(0);
    }
  });
  it("requires both owned binaries and matching metadata before recognizing completion", async () => {
    for (const changed of ["original", "thumbnail", "metadata"]) {
      const s = setup();
      const metadata = `${s.io.root}items/photo.ttl`;
      s.lost.add(`PUT ${metadata}`);
      s.fail.set(`GET ${metadata}`, 500);
      expect((await s.upload())[0]?.ok).toBe(false);
      s.lost.clear();
      s.fail.clear();
      if (changed === "metadata") {
        const loaded = await s.io.loadPhoto(metadata);
        if (!loaded.photo) throw new Error("Missing fixture");
        await s.io.savePhoto(
          metadata,
          { ...loaded.photo, name: "Unrelated" },
          { etag: loaded.etag as string },
        );
      } else {
        const url =
          changed === "original"
            ? `${s.io.root}originals/photo.png`
            : `${s.io.root}thumbs/photo.webp`;
        await s.pod.fetch(url, { method: "PUT", body: "replacement" });
      }
      expect((await s.upload())[0]?.ok).toBe(false);
    }
  });
});
