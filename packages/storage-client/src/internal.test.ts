// AUTHORED-BY Claude Opus 5.5
import { describe, expect, test } from "vitest";
import { isWithin, MAX_PAGES, paginate, pathParent, throwIfAborted, toBytes } from "./internal.js";
import type { Entry, Page } from "./types.js";

const entry = (url: string): Entry => ({
  url,
  kind: "resource",
  contentType: null,
  size: null,
  modified: null,
  types: [],
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe("paginate", () => {
  test("follows next cursors until null", async () => {
    const pages: Record<string, Page<Entry>> = {
      first: { items: [entry("a")], next: { url: "p2" }, total: 2, etag: null },
      p2: { items: [entry("b")], next: null, total: 2, etag: null },
    };
    const items = await collect(
      paginate("c/", async (cursor) => pages[cursor?.url ?? "first"] as Page<Entry>, undefined),
    );
    expect(items.map((item) => item.url)).toEqual(["a", "b"]);
  });

  test("refuses a repeated page and a page pointing at the container", async () => {
    const loop = async () => ({ items: [], next: { url: "p" }, total: null, etag: null });
    await expect(collect(paginate("c/", loop, undefined))).rejects.toMatchObject({
      code: "invalid-response",
      url: "p",
    });
    const self = async () => ({ items: [], next: { url: "c/" }, total: null, etag: null });
    await expect(collect(paginate("c/", self, undefined))).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  test("stops at the page cap", async () => {
    let n = 0;
    const endless = async () => ({ items: [], next: { url: `p${n++}` }, total: null, etag: null });
    await expect(collect(paginate("c/", endless, undefined))).rejects.toThrow(
      `exceeds ${MAX_PAGES} pages`,
    );
    expect(n).toBe(MAX_PAGES);
  });

  test("honours an aborted signal before each page", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(
      collect(
        paginate(
          "c/",
          async () => ({ items: [], next: null, total: 0, etag: null }),
          controller.signal,
        ),
      ),
    ).rejects.toMatchObject({ code: "network", retryable: false });
  });
});

describe("url helpers", () => {
  test("isWithin respects origin, credentials and path boundaries", () => {
    const root = "https://pod.example/alice/";
    expect(isWithin("https://pod.example/alice/", root)).toBe(true);
    expect(isWithin("https://pod.example/alice/x/y", root)).toBe(true);
    expect(isWithin("https://pod.example/alice-other/x", root)).toBe(false);
    expect(isWithin("https://pod.example/", root)).toBe(false);
    expect(isWithin("http://pod.example/alice/x", root)).toBe(false);
    expect(isWithin("https://u:p@pod.example/alice/x", root)).toBe(false);
    expect(isWithin("not a url", root)).toBe(false);
    expect(isWithin("https://pod.example/alice", "https://pod.example/alice")).toBe(true);
    expect(isWithin("https://pod.example/alice/x", "https://pod.example/alice")).toBe(true);
  });

  test("pathParent walks one level up and stops at the root", () => {
    const root = "https://pod.example/";
    expect(pathParent("https://pod.example/a/b", root)).toBe("https://pod.example/a/");
    expect(pathParent("https://pod.example/a/b/", root)).toBe("https://pod.example/a/");
    expect(pathParent("https://pod.example/a?x#y", root)).toBe("https://pod.example/");
    expect(pathParent(root, root)).toBeNull();
  });

  test("throwIfAborted is silent without an aborted signal", () => {
    expect(() => throwIfAborted("GET", "u", undefined)).not.toThrow();
    expect(() => throwIfAborted("GET", "u", new AbortController().signal)).not.toThrow();
  });
});

describe("toBytes", () => {
  test("accepts every Body type", async () => {
    const expected = new TextEncoder().encode("héllo");
    expect(await toBytes("héllo")).toEqual(expected);
    const source = expected.slice();
    const copy = await toBytes(source);
    source[0] = 0;
    expect(copy).toEqual(expected);
    expect(await toBytes(new Blob([expected]))).toEqual(expected);
    expect(await toBytes(new Blob([expected]).stream())).toEqual(expected);
  });
});
