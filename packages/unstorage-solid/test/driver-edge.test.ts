// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Edge / error-path coverage for the driver: HEAD-405 fallbacks, error
// surfacing, getMeta without optional headers, setItemRaw body normalisation,
// parent-container creation errors, and factory validation.

import { describe, expect, it } from "vitest";
import solidDriver, { SolidHttpError } from "../src/index.js";
import { MockLdp } from "./mock-ldp.js";

const BASE = "https://pod.example/kv/";

/** A fetch stub keyed by `${method} ${path-suffix-match}` returning a Response. */
function routedFetch(
  routes: (method: string, url: string) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return (async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const method = (init?.method ?? "GET").toUpperCase();
    return routes(method, url);
  }) as typeof globalThis.fetch;
}

describe("factory validation", () => {
  it("throws when fetch is explicitly not a function", () => {
    expect(() =>
      // @ts-expect-error intentional misuse
      solidDriver({ base: BASE, fetch: 123 }),
    ).toThrow(/no `fetch` available/);
  });

  it("normalises a base without trailing slash", async () => {
    const mock = new MockLdp({ base: "https://pod.example/kv" });
    const driver = solidDriver({ base: "https://pod.example/kv", fetch: mock.fetch });
    await driver.setItem?.("x", "1", {});
    expect(await driver.getItem?.("x", {})).toBe("1");
  });
});

describe("hasItem error after GET fallback", () => {
  it("throws when the GET fallback also errors", async () => {
    const driver = solidDriver({
      base: BASE,
      fetch: routedFetch((method) =>
        method === "HEAD"
          ? new Response(null, { status: 405 })
          : new Response(null, { status: 500, statusText: "boom" }),
      ),
    });
    await expect(driver.hasItem?.("x", {})).rejects.toBeInstanceOf(SolidHttpError);
  });
});

describe("getItemRaw error surfacing", () => {
  it("throws on a non-404 error", async () => {
    const driver = solidDriver({
      base: BASE,
      fetch: routedFetch(() => new Response(null, { status: 403, statusText: "no" })),
    });
    await expect(driver.getItemRaw?.("x", {})).rejects.toBeInstanceOf(SolidHttpError);
  });
});

describe("getMeta optional header handling", () => {
  it("omits mtime/size/etag/mimeType when headers absent, keeps status", async () => {
    const driver = solidDriver({
      base: BASE,
      fetch: routedFetch(() => new Response(null, { status: 200 })),
    });
    const meta = await driver.getMeta?.("x", {});
    expect(meta).toEqual({ status: 200 });
  });

  it("ignores an unparseable last-modified and non-numeric content-length", async () => {
    const driver = solidDriver({
      base: BASE,
      fetch: routedFetch(
        () =>
          new Response(null, {
            status: 200,
            headers: new Headers({ "last-modified": "not-a-date", "content-length": "abc" }),
          }),
      ),
    });
    const meta = await driver.getMeta?.("x", {});
    expect(meta?.mtime).toBeUndefined();
    expect(meta?.size).toBeUndefined();
  });

  it("falls back to GET when HEAD is 405", async () => {
    const driver = solidDriver({
      base: BASE,
      fetch: routedFetch((method) =>
        method === "HEAD"
          ? new Response(null, { status: 405 })
          : new Response("body", {
              status: 200,
              headers: new Headers({ etag: '"e1"', "content-length": "4" }),
            }),
      ),
    });
    const meta = await driver.getMeta?.("x", {});
    expect(meta?.etag).toBe('"e1"');
    expect(meta?.size).toBe(4);
  });
});

describe("setItemRaw body normalisation", () => {
  it("accepts an ArrayBuffer", async () => {
    const mock = new MockLdp({ base: BASE });
    const driver = solidDriver({ base: BASE, fetch: mock.fetch });
    const ab = new Uint8Array([9, 8, 7]).buffer;
    await driver.setItemRaw?.("ab", ab, {});
    const out = (await driver.getItemRaw?.("ab", {})) as Uint8Array;
    expect([...out]).toEqual([9, 8, 7]);
  });

  it("accepts a typed-array view with a non-zero byteOffset", async () => {
    const mock = new MockLdp({ base: BASE });
    const driver = solidDriver({ base: BASE, fetch: mock.fetch });
    const backing = new Uint8Array([0, 1, 2, 3, 4]);
    const view = new Uint8Array(backing.buffer, 1, 3); // [1,2,3]
    await driver.setItemRaw?.("view", view, {});
    const out = (await driver.getItemRaw?.("view", {})) as Uint8Array;
    expect([...out]).toEqual([1, 2, 3]);
  });

  it("JSON-stringifies a plain object fallback", async () => {
    const mock = new MockLdp({ base: BASE });
    const driver = solidDriver({ base: BASE, fetch: mock.fetch });
    await driver.setItemRaw?.("obj", { a: 1 }, {});
    const out = (await driver.getItemRaw?.("obj", {})) as Uint8Array;
    expect(new TextDecoder().decode(out)).toBe('{"a":1}');
  });
});

describe("parent-container creation error", () => {
  it("surfaces a non-tolerated error while creating an ancestor container", async () => {
    // Resource PUT returns 409 (missing parent) -> driver tries to PUT the parent
    // container, which returns 500 -> surfaced.
    const driver = solidDriver({
      base: BASE,
      fetch: routedFetch((method, url) => {
        if (method === "PUT" && url.endsWith("/")) {
          return new Response(null, { status: 500, statusText: "container boom" });
        }
        if (method === "PUT") {
          return new Response(null, { status: 409, statusText: "missing parent" });
        }
        return new Response(null, { status: 404 });
      }),
    });
    await expect(driver.setItem?.("a:b:c", "x", {})).rejects.toBeInstanceOf(SolidHttpError);
  });

  it("surfaces a final resource-PUT error after parent creation", async () => {
    const driver = solidDriver({
      base: BASE,
      fetch: routedFetch((method, url) => {
        if (method === "PUT" && url.endsWith("/")) {
          return new Response(null, { status: 201 }); // container created OK
        }
        if (method === "PUT") {
          return new Response(null, { status: 403, statusText: "denied" }); // resource PUT fails twice
        }
        return new Response(null, { status: 404 });
      }),
    });
    await expect(driver.setItem?.("a:b", "x", {})).rejects.toBeInstanceOf(SolidHttpError);
  });
});

describe("clear with no driver.clear-reachable prefix is safe", () => {
  it("clears the whole mount when called with empty base", async () => {
    const mock = new MockLdp({ base: BASE });
    const driver = solidDriver({ base: BASE, fetch: mock.fetch });
    await driver.setItem?.("a", "1", {});
    await driver.setItem?.("b:c", "2", {});
    await driver.clear?.("", {});
    expect(await driver.getKeys("", {})).toEqual([]);
    // The base container itself is preserved (never deleted).
    expect(mock.resources.has(BASE)).toBe(true);
  });
});
