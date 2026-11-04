// AUTHORED-BY Codex GPT-6.1-Sol
import type { StorageClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { createDriveStore, listContainer } from "../src/drive.js";

const ROOT = "https://drive.example/";

describe.each(["solid", "lws"] as const)("Drive on memory %s", (protocol) => {
  it("lists every page, sorts folders first, and reads/writes/moves/deletes returned URLs", async () => {
    const storage = createMemoryStorage({ protocol, root: ROOT, pageSize: 1, moveResource: true });
    const drive = createDriveStore({ root: ROOT, storage });
    const folder = await drive.create(ROOT, null, { kind: "container", name: "archive" });
    const b = await drive.create(ROOT, "old", { name: "b.txt", contentType: "text/plain" });
    const a = await drive.create(ROOT, new Uint8Array([1, 2]), {
      name: "a.bin",
      contentType: "application/octet-stream",
    });
    const listing = await drive.list();
    expect(listing.etag).toBe((await storage.head(ROOT)).etag);
    expect(listing.container.entries.map((e) => e.url)).toEqual([folder.url, a.url, b.url]);
    expect(listing.container.entries[1]).toMatchObject({
      size: 2,
      contentType: "application/octet-stream",
    });
    expect(listing.container.entries[1]?.modifiedAt).toBeInstanceOf(Date);
    expect(await (await drive.read(b.url)).text()).toBe("old");
    const saved = await drive.write(b.url, "new", "text/plain", b.etag as string);
    await expect(drive.write(b.url, "lost", "text/plain", b.etag as string)).rejects.toMatchObject({
      code: "precondition-failed",
    });
    await expect(drive.move(b.url, folder.url, b.etag as string)).rejects.toMatchObject({
      code: "precondition-failed",
    });
    await expect(drive.remove(b.url, b.etag as string)).rejects.toMatchObject({
      code: "precondition-failed",
    });
    const moved = await drive.move(b.url, folder.url, saved.etag as string, "renamed.txt");
    expect(await (await drive.read(moved.url)).text()).toBe("new");
    expect((await drive.list(folder.url)).container.entries.map((e) => e.url)).toEqual([moved.url]);
    await drive.remove(moved.url, moved.etag as string);
    expect((await drive.list(folder.url)).container.entries).toEqual([]);
    const child = await drive.create(folder.url, "child", {
      name: "child",
      contentType: "text/plain",
    });
    expect(child.url).toBeTruthy();
    await drive.remove(folder.url, (await storage.head(folder.url)).etag as string, true);
    expect((await drive.list()).container.entries.map((e) => e.url)).toEqual([a.url]);
  });

  it("refuses foreign resources and propagates unsupported sharing", async () => {
    const storage = createMemoryStorage({ protocol, root: ROOT });
    const drive = createDriveStore({ root: ROOT, storage });
    await expect(drive.read("https://foreign.example/private")).rejects.toMatchObject({
      code: "scope",
    });
    await expect(
      drive.share(ROOT, { agent: { public: true }, modes: ["read"] }),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it("shares through pod-access when an access model is advertised", async () => {
    const memory = createMemoryStorage({ protocol, root: ROOT });
    const file = await memory.create(ROOT, "private", { name: "file", contentType: "text/plain" });
    const acl = await memory.create(ROOT, "", { name: "file.acl", contentType: "text/turtle" });
    const storage: StorageClient = {
      ...memory,
      features: {
        ...memory.features,
        accessControl: { state: "available", detail: { model: "wac" }, evidence: "fixture" },
      },
      async head(url, opts) {
        return {
          ...(await memory.head(url, opts)),
          links: new Map([["acl", [{ target: acl.url, params: {} }]]]),
        };
      },
    };
    const drive = createDriveStore({ root: ROOT, storage });
    if (protocol === "lws") {
      await expect(
        drive.share(file.url, { agent: { public: true }, modes: ["read"] }),
      ).rejects.toMatchObject({ code: "unsupported" });
    } else {
      const grant = await drive.share(
        file.url,
        { agent: { public: true }, modes: ["read"] },
        { inherit: false },
      );
      expect(grant.id).toContain(acl.url);
      expect(await (await memory.read(acl.url)).text()).toContain(
        "http://xmlns.com/foaf/0.1/Agent",
      );
    }
  });
});

it("preserves a slashless LWS container id and its declared entry kinds", async () => {
  const memory = createMemoryStorage({ protocol: "lws", root: ROOT });
  const opaque = `${ROOT}opaque`;
  const storage: StorageClient = {
    ...memory,
    head: vi.fn(async () => ({ ...(await memory.head(ROOT)), url: opaque })),
    async *listAll(url) {
      expect(url).toBe(opaque);
      yield {
        url: ROOT,
        kind: "resource",
        contentType: null,
        size: null,
        modified: null,
        types: [],
      };
      yield {
        url: `${ROOT}folder-without-slash`,
        kind: "container",
        contentType: null,
        size: null,
        modified: null,
        types: [],
      };
    },
  };
  const listing = await listContainer(opaque, { storage });
  expect(listing.url).toBe(opaque);
  expect(listing.container.entries.map((e) => [e.name, e.isContainer])).toEqual([
    ["folder-without-slash", true],
    ["drive.example", false],
  ]);
});

it("uses the discovered SDK client once for a Drive store", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response("file", { headers: { "content-type": "text/plain" } }),
  );
  const drive = createDriveStore({ root: ROOT, fetch });
  expect(await (await drive.read(`${ROOT}file`)).text()).toBe("file");
  expect(await (await drive.read(`${ROOT}file`)).text()).toBe("file");
  const original = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    expect(await (await createDriveStore({ root: ROOT }).read(`${ROOT}file`)).text()).toBe("file");
  } finally {
    globalThis.fetch = original;
  }
});

it("keeps malformed UTF-8 name escapes without failing the listing", async () => {
  const memory = createMemoryStorage({ root: ROOT });
  const storage: StorageClient = {
    ...memory,
    async *listAll() {
      yield {
        url: `${ROOT}%FF.txt`,
        kind: "resource",
        contentType: null,
        size: null,
        modified: null,
        types: [],
      };
    },
  };
  expect((await listContainer(ROOT, { storage })).container.entries[0]?.name).toBe("%FF.txt");
});
