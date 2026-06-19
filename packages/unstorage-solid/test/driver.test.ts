// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { createStorage } from "unstorage";
import { describe, expect, it } from "vitest";
import solidDriver, { SolidHttpError, SolidPreconditionFailedError } from "../src/index.js";
import { MockLdp } from "./mock-ldp.js";

const BASE = "https://pod.example/kv/";

function makeStorage(mock: MockLdp) {
  return createStorage({ driver: solidDriver({ base: BASE, fetch: mock.fetch }) });
}

describe("hasItem", () => {
  it("true for an existing resource, false for a 404", async () => {
    const mock = new MockLdp({ base: BASE });
    mock.seed(`${BASE}foo`, "hi");
    const storage = makeStorage(mock);
    expect(await storage.hasItem("foo")).toBe(true);
    expect(await storage.hasItem("missing")).toBe(false);
  });

  it("falls back to GET when HEAD returns 405", async () => {
    const mock = new MockLdp({ base: BASE, headReturns405: true });
    mock.seed(`${BASE}foo`, "hi");
    const storage = makeStorage(mock);
    expect(await storage.hasItem("foo")).toBe(true);
  });
});

describe("getItem / setItem", () => {
  it("text round-trips", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    await storage.setItem("greeting", "hello world");
    expect(await storage.getItem("greeting")).toBe("hello world");
  });

  it("JSON round-trips (destr at the Storage layer)", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    await storage.setItem("config", { dark: true, level: 3 });
    expect(await storage.getItem("config")).toEqual({ dark: true, level: 3 });
  });

  it("getItem of a missing key returns null", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    expect(await storage.getItem("nope")).toBeNull();
  });

  it("getItem surfaces a non-404 error", async () => {
    const driver = solidDriver({
      base: BASE,
      fetch: async () => new Response(null, { status: 500, statusText: "boom" }),
    });
    await expect(driver.getItem?.("x", {})).rejects.toBeInstanceOf(SolidHttpError);
  });
});

describe("getItemRaw / setItemRaw", () => {
  it("binary round-trips byte-identically", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    await storage.setItemRaw("blob", bytes);
    const out = (await storage.getItemRaw("blob")) as Uint8Array;
    expect(out).toBeInstanceOf(Uint8Array);
    expect([...out]).toEqual([...bytes]);
  });

  it("getItemRaw of a missing key returns null", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    expect(await storage.getItemRaw("nope")).toBeNull();
  });
});

describe("setItem parent-container creation", () => {
  it("creates intermediate containers when the server requires them (ESS-like)", async () => {
    const mock = new MockLdp({ base: BASE, autoCreateParents: false });
    const storage = makeStorage(mock);
    await storage.setItem("a:b:c", "deep");
    expect(await storage.getItem("a:b:c")).toBe("deep");
    // The intermediate containers now exist in the mock.
    expect(mock.resources.has(`${BASE}a/`)).toBe(true);
    expect(mock.resources.has(`${BASE}a/b/`)).toBe(true);
  });

  it("works when the server auto-creates parents (CSS-like)", async () => {
    const mock = new MockLdp({ base: BASE, autoCreateParents: true });
    const storage = makeStorage(mock);
    await storage.setItem("x:y:z", "deep2");
    expect(await storage.getItem("x:y:z")).toBe("deep2");
  });
});

describe("removeItem", () => {
  it("removes an existing item", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    await storage.setItem("foo", "bar");
    await storage.removeItem("foo");
    expect(await storage.hasItem("foo")).toBe(false);
  });

  it("is idempotent for a missing item (no throw)", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    await expect(storage.removeItem("missing")).resolves.toBeUndefined();
  });

  it("surfaces a non-404 delete error", async () => {
    const driver = solidDriver({
      base: BASE,
      fetch: async () => new Response(null, { status: 403, statusText: "Forbidden" }),
    });
    await expect(driver.removeItem?.("x", {})).rejects.toBeInstanceOf(SolidHttpError);
  });
});

describe("getKeys", () => {
  it("lists flat keys from a real container Turtle listing", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    await storage.setItem("alpha", "1");
    await storage.setItem("beta", "2");
    const keys = await storage.getKeys();
    expect(new Set(keys)).toEqual(new Set(["alpha", "beta"]));
  });

  it("recurses into nested containers", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    await storage.setItem("top", "0");
    await storage.setItem("dir:child", "1");
    await storage.setItem("dir:sub:leaf", "2");
    const keys = await storage.getKeys();
    expect(new Set(keys)).toEqual(new Set(["top", "dir:child", "dir:sub:leaf"]));
  });

  it("respects maxDepth", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    await storage.setItem("top", "0");
    await storage.setItem("dir:child", "1");
    await storage.setItem("dir:sub:leaf", "2");
    // maxDepth 1 => only descend one container level (dir/), not dir/sub/.
    const keys = await storage.getKeys(undefined, { maxDepth: 1 });
    expect(new Set(keys)).toEqual(new Set(["top", "dir:child"]));
  });

  it("lists keys under a prefix", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    await storage.setItem("top", "0");
    await storage.setItem("dir:child", "1");
    const keys = await storage.getKeys("dir");
    expect(new Set(keys)).toEqual(new Set(["dir:child"]));
  });

  it("round-trips a key with a space/special char through the container listing", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    await storage.setItem("my docs:report #1", "x");
    const keys = await storage.getKeys();
    expect(keys).toContain("my docs:report #1");
  });

  it("returns [] for a missing base container", async () => {
    const driver = solidDriver({
      base: BASE,
      fetch: async () => new Response(null, { status: 404, statusText: "Not Found" }),
    });
    expect(await driver.getKeys("", {})).toEqual([]);
  });
});

describe("clear", () => {
  it("removes all members under base", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    await storage.setItem("a", "1");
    await storage.setItem("dir:b", "2");
    await storage.setItem("dir:sub:c", "3");
    await storage.clear();
    expect(await storage.getKeys()).toEqual([]);
  });

  it("removes only the prefix sub-tree (driver.clear with a relativeBase prefix)", async () => {
    // NOTE: unstorage's `storage.clear("dir")` on a root-mounted driver does NOT
    // reach driver.clear (the root mount is a *parent* of "dir:", excluded by
    // getMounts(base, false)). The driver's prefix-clear contract is exercised by
    // calling driver.clear with unstorage's relativeBase form ("dir:") directly —
    // which is what unstorage passes when the driver is mounted UNDER a prefix.
    const mock = new MockLdp({ base: BASE });
    const driver = solidDriver({ base: BASE, fetch: mock.fetch });
    await driver.setItem?.("keep", "1", {});
    await driver.setItem?.("dir:gone", "2", {});
    await driver.setItem?.("dir:sub:deep", "3", {});
    await driver.clear?.("dir:", {});
    const keys = await driver.getKeys("", {});
    expect(new Set(keys)).toEqual(new Set(["keep"]));
    // The dir/ container itself was removed too.
    expect(mock.resources.has(`${BASE}dir/`)).toBe(false);
  });
});

describe("getMeta", () => {
  it("returns etag, mtime, size and mimeType", async () => {
    const mock = new MockLdp({ base: BASE });
    const storage = makeStorage(mock);
    await storage.setItem("doc", "hello");
    const meta = await storage.getMeta("doc");
    expect(meta).not.toBeNull();
    expect(typeof meta.etag).toBe("string");
    expect(meta.mtime).toBeInstanceOf(Date);
    expect(meta.size).toBe(5);
    expect(meta.mimeType).toContain("text/plain");
  });

  it("returns null for a missing key", async () => {
    const mock = new MockLdp({ base: BASE });
    const driver = solidDriver({ base: BASE, fetch: mock.fetch });
    expect(await driver.getMeta?.("missing", {})).toBeNull();
  });
});

describe("optimistic concurrency (If-Match)", () => {
  it("rejects a stale-etag write with a precondition error", async () => {
    const mock = new MockLdp({ base: BASE });
    const driver = solidDriver({ base: BASE, fetch: mock.fetch });
    await driver.setItem?.("doc", "v1", {});
    await expect(driver.setItem?.("doc", "v2", { etag: '"etag-stale"' })).rejects.toBeInstanceOf(
      SolidPreconditionFailedError,
    );
  });

  it("succeeds with a matching etag", async () => {
    const mock = new MockLdp({ base: BASE });
    const driver = solidDriver({ base: BASE, fetch: mock.fetch });
    await driver.setItem?.("doc", "v1", {});
    const meta = await driver.getMeta?.("doc", {});
    const etag = meta?.etag as string;
    await expect(driver.setItem?.("doc", "v2", { etag })).resolves.toBeUndefined();
    expect(await driver.getItem?.("doc", {})).toBe("v2");
  });
});

describe("driver factory validation", () => {
  it("throws without a base", () => {
    // @ts-expect-error intentional misuse
    expect(() => solidDriver({})).toThrow(/`base` option is required/);
  });

  it("exposes the driver name and flags", () => {
    const mock = new MockLdp({ base: BASE });
    const driver = solidDriver({ base: BASE, fetch: mock.fetch });
    expect(driver.name).toBe("solid");
    expect(driver.flags?.maxDepth).toBe(true);
  });
});

describe("SSRF / containment defence", () => {
  it("never lets a traversal key produce a request", async () => {
    const mock = new MockLdp({ base: BASE });
    const driver = solidDriver({ base: BASE, fetch: mock.fetch });
    await expect(driver.getItem?.("a:..:b", {})).rejects.toThrow(/traversal/);
    // No request reached the mock for the traversal key.
    expect(mock.requests.some((r) => r.url.includes(".."))).toBe(false);
  });
});

describe("header injection", () => {
  it("merges driver headers and per-call headers into requests", async () => {
    const mock = new MockLdp({ base: BASE });
    const driver = solidDriver({
      base: BASE,
      fetch: mock.fetch,
      headers: { "x-driver": "d" },
    });
    await driver.setItem?.("k", "v", { headers: { "x-call": "c" } });
    const put = mock.requests.find((r) => r.method === "PUT" && r.url.endsWith("/kv/k"));
    expect(put?.headers["x-driver"]).toBe("d");
    expect(put?.headers["x-call"]).toBe("c");
  });
});
