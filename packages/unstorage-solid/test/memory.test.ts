// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { type Entry, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createStorage } from "unstorage";
import { describe, expect, it, vi } from "vitest";
import { listContainer } from "../src/container.js";
import solidDriver, { SolidHttpError, SolidPreconditionFailedError } from "../src/index.js";

const BASE = "https://memory.example/kv/";

describe.each(["solid", "lws"] as const)("KV through StorageClient (%s)", (protocol) => {
  function fixture() {
    const backend = createMemoryStorage({ protocol, root: BASE, pageSize: 1 });
    const fetch = vi.fn<typeof globalThis.fetch>();
    const driver = solidDriver({ base: BASE, storage: backend, fetch });
    return { backend, fetch, driver, storage: createStorage({ driver }) };
  }

  it("round-trips text, JSON, binary and nested escaped keys", async () => {
    const { storage, fetch } = fixture();
    await storage.setItem("greeting", "hello");
    await storage.setItem("config", { dark: true });
    await storage.setItemRaw("dir:blob", new Uint8Array([0, 255, 1]));
    await storage.setItem("dir:a%3Ab", "colon");
    await storage.setItem("dir:percent%25", "percent");
    await storage.setItem("資料:📁:café", "Unicode");
    expect(await storage.getItem("greeting")).toBe("hello");
    expect(await storage.getItem("config")).toEqual({ dark: true });
    expect(await storage.getItemRaw("dir:blob")).toEqual(new Uint8Array([0, 255, 1]));
    expect(await storage.getItem("dir:a%3Ab")).toBe("colon");
    expect(await storage.getItem("dir:percent%25")).toBe("percent");
    expect(await storage.getItem("資料:📁:café")).toBe("Unicode");
    expect(await storage.hasItem("absent")).toBe(false);
    expect(await storage.getItem("absent")).toBeNull();
    expect(await storage.getItemRaw("absent")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await storage.dispose();
  });

  it("preserves ETags, content type, date and size in getMeta", async () => {
    const { driver, storage } = fixture();
    await storage.setItem("a", "hello");
    const meta = await driver.getMeta?.("a", {});
    expect(meta).toMatchObject({
      etag: expect.any(String),
      size: 5,
      mimeType: "text/plain; charset=utf-8",
      mtime: expect.any(Date),
    });
    expect(await driver.getMeta?.("absent", {})).toBeNull();
    await driver.setItem?.("a", "new", { etag: meta?.etag });
    await expect(driver.setItem?.("a", "stale", { etag: meta?.etag })).rejects.toBeInstanceOf(
      SolidPreconditionFailedError,
    );
    expect(await storage.getItem("a")).toBe("new");
  });

  it("lists all pages with prefix and depth, clears leaves before containers and retains base", async () => {
    const { backend, driver, storage } = fixture();
    for (const key of ["a", "b", "dir:c", "dir:sub:d"]) await storage.setItem(key, key);
    expect((await driver.getKeys("", {})).sort()).toEqual(["a", "b", "dir:c", "dir:sub:d"]);
    expect((await driver.getKeys("dir:", {})).sort()).toEqual(["dir:c", "dir:sub:d"]);
    expect((await driver.getKeys("", { maxDepth: 0 })).sort()).toEqual(["a", "b"]);
    expect((await driver.getKeys("", { maxDepth: 1 })).sort()).toEqual(["a", "b", "dir:c"]);
    const remove = vi.spyOn(backend, "delete");
    await driver.clear?.("dir:", {});
    expect((await driver.getKeys("", {})).sort()).toEqual(["a", "b"]);
    const removed = remove.mock.calls.map(([url]) => url);
    expect(removed.indexOf(`${BASE}dir/sub/d`)).toBeLessThan(removed.indexOf(`${BASE}dir/sub/`));
    expect(removed.at(-1)).toBe(`${BASE}dir/`);
    await driver.clear?.("", {});
    expect(await driver.getKeys("", {})).toEqual([]);
    expect((await backend.head(BASE)).kind).toBe("container");
  });

  it("removes conditionally, handles repeated removal and refuses missing validators", async () => {
    const { backend, driver, storage } = fixture();
    await storage.setItem("a", "one");
    const etag = (await backend.head(`${BASE}a`)).etag;
    const remove = vi.spyOn(backend, "delete");
    await storage.removeItem("a");
    expect(remove).toHaveBeenCalledWith(`${BASE}a`, { ifMatch: etag });
    await storage.removeItem("a");
    expect(remove).toHaveBeenCalledTimes(1);
    await storage.setItem("b", "two");
    const head = backend.head.bind(backend);
    vi.spyOn(backend, "head").mockImplementationOnce(async (url) => ({
      ...(await head(url)),
      etag: null,
    }));
    await expect(driver.removeItem?.("b", {})).rejects.toThrow(/without an ETag/);
    expect(await storage.getItem("b")).toBe("two");
  });

  it("rejects poisoned listing members and invalid keys without a foreign operation", async () => {
    const { backend, driver } = fixture();
    const entry = (url: string): Entry => ({
      url,
      kind: "resource",
      size: null,
      modified: null,
      contentType: null,
      types: [],
    });
    vi.spyOn(backend, "listAll").mockImplementation(async function* () {
      for (const url of [
        BASE,
        `${BASE}?alias`,
        "https://evil.example/x",
        "https://memory.example/outside/x",
        `${BASE}sub/deep`,
        `${BASE}bad%2Fkey`,
        "http://[",
        `${BASE}ok`,
      ])
        yield entry(url);
    });
    expect(await driver.getKeys("", {})).toEqual(["ok"]);
    const read = vi.spyOn(backend, "read");
    for (const key of ["../x", "a%2Fb", "a%5Cb", "a::b", "%2e%2e"]) {
      await expect(driver.getItem?.(key, {})).rejects.toThrow();
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("does not delete from a partially failed listing", async () => {
    const { backend, driver } = fixture();
    const remove = vi.spyOn(backend, "delete");
    vi.spyOn(backend, "listAll").mockImplementation(async function* () {
      yield {
        url: `${BASE}a`,
        kind: "resource",
        size: null,
        modified: null,
        contentType: null,
        types: [],
      };
      throw new StorageError("network", { method: "GET", url: BASE });
    });
    await expect(driver.clear?.("", {})).rejects.toMatchObject({ code: "network" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("preserves HTTP and precondition error classes", async () => {
    const { backend, driver } = fixture();
    vi.spyOn(backend, "read").mockRejectedValueOnce(
      new StorageError("forbidden", { method: "GET", url: `${BASE}a`, status: 403 }),
    );
    await expect(driver.getItem?.("a", {})).rejects.toBeInstanceOf(SolidHttpError);
    vi.spyOn(backend, "write").mockRejectedValueOnce(
      new StorageError("precondition-required", { method: "PUT", url: `${BASE}a`, status: 428 }),
    );
    await expect(driver.setItem?.("a", "x", { etag: '"e"' })).rejects.toBeInstanceOf(
      SolidPreconditionFailedError,
    );
  });
});

it("passes decoded creation names to injected LWS memory clients", async () => {
  const backend = createMemoryStorage({ protocol: "lws", root: BASE });
  const fetch = vi.fn<typeof globalThis.fetch>();
  const driver = solidDriver({ base: BASE, storage: backend, fetch });
  const create = vi.spyOn(backend, "create");
  await driver.setItem?.("資料:📁:café%3A100%25", "value", {});
  expect(create.mock.calls.map(([, , opts]) => opts?.name)).toEqual([
    "café:100%",
    "資料",
    "📁",
    "café:100%",
  ]);
  expect(await driver.getItem?.("資料:📁:café%3A100%25", {})).toBe("value");
  expect(fetch).not.toHaveBeenCalled();
});

it("refuses server-chosen identifiers for the fixed key layout", async () => {
  const storage = createMemoryStorage({ protocol: "lws", root: BASE });
  vi.spyOn(storage, "create").mockResolvedValueOnce({
    url: `${BASE}opaque`,
    etag: '"e"',
    created: true,
  });
  const driver = solidDriver({ base: BASE, storage });
  await expect(driver.setItem?.("a", "x", {})).rejects.toThrow(/preserve the key name/);
});

it("does not treat an HTTP 405 as an empty container", async () => {
  const storage = createMemoryStorage({ protocol: "solid", root: BASE });
  vi.spyOn(storage, "listAll").mockReturnValue({
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        throw new StorageError("method-not-allowed", { method: "GET", url: BASE, status: 405 });
      },
    }),
  });
  await expect(listContainer(BASE, BASE, storage)).rejects.toThrow(/405/);
});

it("has no direct pod-fetch or backend imports in the adapter modules", () => {
  for (const file of ["index.ts", "container.ts", "watch.ts"]) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    expect(source).not.toMatch(
      /\b(?:fetch|fetchImpl|doFetch)\s*\(|from\s+["']@jeswr\/storage-client\//,
    );
  }
});

describe("conditional mutation edge cases", () => {
  function fixture(protocol: "solid" | "lws" = "solid") {
    const backend = createMemoryStorage({ protocol, root: BASE });
    return { backend, driver: solidDriver({ base: BASE, storage: backend }) };
  }
  const failure = (status: 404 | 409 | 412 | 500) =>
    new StorageError(
      status === 404
        ? "not-found"
        : status === 409
          ? "conflict"
          : status === 412
            ? "precondition-failed"
            : "server",
      { method: "PUT", url: `${BASE}a`, status },
    );

  it("overwrites an existing LWS item without an explicit precondition", async () => {
    const { backend, driver } = fixture("lws");
    await driver.setItem?.("a", "first", {});
    const write = vi.spyOn(backend, "write");
    await driver.setItem?.("a", "second", {});
    expect(await driver.getItem?.("a", {})).toBe("second");
    expect(write).toHaveBeenCalledWith(
      `${BASE}a`,
      "second",
      expect.objectContaining({ ifMatch: "*" }),
    );
  });

  it("never retries a failed conditional write", async () => {
    const { backend, driver } = fixture();
    const write = vi.spyOn(backend, "write").mockRejectedValue(failure(404));
    const create = vi.spyOn(backend, "create");
    await expect(driver.setItem?.("a:b", "x", { etag: '"e"' })).rejects.toBeInstanceOf(
      SolidHttpError,
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    412, 500,
  ] as const)("surfaces a %s after the single parent-creation retry", async (status) => {
    const { backend, driver } = fixture();
    const write = vi
      .spyOn(backend, "write")
      .mockRejectedValueOnce(failure(409))
      .mockRejectedValueOnce(failure(status));
    await expect(driver.setItem?.("a:b", "x", {})).rejects.toBeInstanceOf(
      status === 412 ? SolidPreconditionFailedError : SolidHttpError,
    );
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("reuses existing ancestors and refuses a resource as a parent", async () => {
    const { backend, driver } = fixture();
    await backend.create(BASE, null, { name: "dir", kind: "container" });
    await driver.setItem?.("dir:sub:a", "x", {});
    expect(await driver.getItem?.("dir:sub:a", {})).toBe("x");
    const other = fixture();
    vi.spyOn(other.backend, "write").mockRejectedValueOnce(failure(409));
    const result = await other.backend.head(BASE);
    vi.spyOn(other.backend, "head").mockResolvedValueOnce({ ...result, kind: "resource" });
    await expect(other.driver.setItem?.("a:b", "x", {})).rejects.toThrow(
      /parent is not a container/,
    );
  });

  it("refuses renamed containers and non-HTTP parent errors", async () => {
    const { backend, driver } = fixture();
    vi.spyOn(backend, "write").mockRejectedValueOnce(failure(409));
    vi.spyOn(backend, "create").mockResolvedValueOnce({
      url: `${BASE}opaque/`,
      created: true,
      etag: '"e"',
    });
    await expect(driver.setItem?.("a:b", "x", {})).rejects.toThrow(/preserve the container name/);
    const other = fixture();
    vi.spyOn(other.backend, "write").mockRejectedValueOnce(failure(409));
    vi.spyOn(other.backend, "head").mockRejectedValueOnce(new Error("head failed"));
    await expect(other.driver.setItem?.("a:b", "x", {})).rejects.toThrow("head failed");
  });

  it("cancels GET fallback bodies before conditional delete", async () => {
    const { backend, driver } = fixture();
    await driver.setItem?.("a", "x", {});
    vi.spyOn(backend, "head").mockRejectedValueOnce(
      new StorageError("method-not-allowed", { method: "HEAD", url: `${BASE}a`, status: 405 }),
    );
    await driver.removeItem?.("a", {});
    expect(await driver.hasItem?.("a", {})).toBe(false);
  });

  it("preserves a raced resource when the conditional delete fails", async () => {
    const { backend, driver } = fixture();
    await driver.setItem?.("a", "x", {});
    const head = backend.head.bind(backend);
    vi.spyOn(backend, "head").mockImplementationOnce(async (url) => {
      const result = await head(url);
      await backend.write(url, "new", {
        ifMatch: result.etag as string,
        contentType: "text/plain",
      });
      return result;
    });
    await expect(driver.removeItem?.("a", {})).rejects.toMatchObject({ status: 412 });
    expect(await driver.getItem?.("a", {})).toBe("new");
  });

  it("keeps readable metadata when size enrichment is forbidden", async () => {
    const { backend, driver } = fixture();
    await driver.setItem?.("a", "x", {});
    vi.spyOn(backend, "parentOf").mockRejectedValueOnce(
      new StorageError("forbidden", { method: "HEAD", url: BASE, status: 403 }),
    );
    expect(await driver.getMeta?.("a", {})).toMatchObject({ etag: expect.any(String) });
    vi.spyOn(backend, "head").mockRejectedValueOnce(failure(500));
    await expect(driver.getMeta?.("a", {})).rejects.toMatchObject({ status: 500 });
  });
});
