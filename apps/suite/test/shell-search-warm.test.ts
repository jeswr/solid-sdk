// AUTHORED-BY Codex GPT-6.1-Sol
import { createFakeRdfEngine } from "@jeswr/rdf-engine/testing";
import type { Entry, StorageClient } from "@jeswr/storage-client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { warmSearchIndex } from "../src/shell/search/pod-source";

const root = "https://pod.example/alice/";
const entry = (name: string, values: Partial<Entry> = {}): Entry => ({
  url: root + name,
  kind: "resource",
  contentType: "text/turtle",
  size: null,
  modified: null,
  types: [],
  ...values,
});
function storage(list: StorageClient["list"]): StorageClient {
  return { root, list, isWithinStorage: (url: string) => url.startsWith(root) } as StorageClient;
}
const page = (items: Entry[], next: { url: string } | null = null) => ({
  items,
  next,
  total: null,
  etag: null,
});

beforeEach(() => {
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    queueMicrotask(callback);
    return 1;
  });
  vi.stubGlobal("cancelIdleCallback", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

it("feeds complete paginated listings and parsed RDF; binary names need no body requests", async () => {
  const engine = createFakeRdfEngine();
  const index = await engine.createIndex();
  const put = vi.spyOn(index, "put");
  const list = vi
    .fn<StorageClient["list"]>()
    .mockResolvedValueOnce(
      page([entry("plan.ttl"), entry("Photo%20album.jpg", { contentType: "image/jpeg" })], {
        url: `${root}?page=2`,
      }),
    )
    .mockResolvedValueOnce(
      page([
        entry("too-large.ttl", { size: 500_000 }),
        entry("foreign", { url: "https://other.example/secret" }),
      ]),
    );
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(`<#it> <http://purl.org/dc/terms/title> "Private plan".`, {
      headers: { "Content-Type": "text/turtle" },
    }),
  );
  await warmSearchIndex(storage(list), index, fetch, new AbortController().signal);
  expect(list).toHaveBeenCalledTimes(2);
  expect(list.mock.calls[1]?.[1]?.cursor).toEqual({ url: `${root}?page=2` });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toBe(`${root}plan.ttl`);
  expect(index.list()).toContain(`${root}plan.ttl`);
  const listing = [...((put.mock.calls[0]?.[1] ?? []) as Iterable<{ object: { value: string } }>)];
  expect(listing.some((quad) => quad.object.value === "Photo album.jpg")).toBe(true);
  engine.dispose();
});

it.each([
  "failure",
  "repeated cursor",
  "oversized listing",
])("never feeds an incomplete listing: %s", async (reason) => {
  const engine = createFakeRdfEngine();
  const index = await engine.createIndex();
  const list = vi.fn<StorageClient["list"]>();
  const cursor = { url: `${root}?page=2` };
  if (reason === "failure")
    list
      .mockResolvedValueOnce(page([entry("plan.ttl")], cursor))
      .mockRejectedValueOnce(new Error("403"));
  if (reason === "repeated cursor") list.mockResolvedValue(page([entry("plan.ttl")], cursor));
  if (reason === "oversized listing")
    list.mockResolvedValue(page(Array.from({ length: 1001 }, (_, i) => entry(`${i}.ttl`))));
  const fetch = vi.fn();
  await warmSearchIndex(storage(list), index, fetch, new AbortController().signal);
  expect(index.size()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
  engine.dispose();
});

it("bounds request count across pages without publishing a truncated graph", async () => {
  const engine = createFakeRdfEngine();
  const index = await engine.createIndex();
  let count = 0;
  const list = vi.fn<StorageClient["list"]>(async () =>
    page([], { url: `${root}?page=${++count}` }),
  );
  await warmSearchIndex(storage(list), index, vi.fn(), new AbortController().signal);
  expect(list).toHaveBeenCalledTimes(200);
  expect(index.list()).toEqual([]);
  engine.dispose();
});

it("bounds breadth and depth, skips cycles and honours slashless backend container kinds", async () => {
  const engine = createFakeRdfEngine();
  const index = await engine.createIndex();
  const list = vi.fn<StorageClient["list"]>(async (url) =>
    page([
      entry("cycle", { url, kind: "container" }),
      entry("next", { url: `${url}next`, kind: "container", contentType: null }),
    ]),
  );
  await warmSearchIndex(storage(list), index, vi.fn(), new AbortController().signal);
  expect(list).toHaveBeenCalledTimes(5);
  engine.dispose();
  const broadEngine = createFakeRdfEngine();
  const broad = await broadEngine.createIndex();
  const broadList = vi.fn<StorageClient["list"]>(async (url) =>
    page(
      url === root
        ? Array.from({ length: 1000 }, (_, i) => entry(`${i}`, { kind: "container" }))
        : [],
    ),
  );
  await warmSearchIndex(storage(broadList), broad, vi.fn(), new AbortController().signal);
  expect(broadList).toHaveBeenCalledTimes(200);
  broadEngine.dispose();
});

it("continues past unreadable RDF and enforces the actual byte limit", async () => {
  const engine = createFakeRdfEngine();
  const index = await engine.createIndex();
  const list = vi
    .fn<StorageClient["list"]>()
    .mockResolvedValue(page([entry("forbidden.ttl"), entry("oversized.ttl"), entry("good.ttl")]));
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(
      new Response(" ".repeat(256 * 1024 + 1), { headers: { "content-type": "text/turtle" } }),
    )
    .mockResolvedValueOnce(
      new Response('<#it> <http://purl.org/dc/terms/title> "Good".', {
        headers: { "content-type": "text/turtle" },
      }),
    );
  await warmSearchIndex(storage(list), index, fetch, new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(index.list()).toContain(`${root}good.ttl`);
  expect(index.list()).not.toContain(`${root}oversized.ttl`);
  expect(index.list()).not.toContain(`${root}forbidden.ttl`);
  engine.dispose();
});

it("uses authenticated metadata before reading resources whose listing omits content type", async () => {
  const engine = createFakeRdfEngine();
  const index = await engine.createIndex();
  const list = vi
    .fn<StorageClient["list"]>()
    .mockResolvedValue(
      page([entry("rdf", { contentType: null }), entry("binary", { contentType: null })]),
    );
  const pod = storage(list);
  pod.head = vi
    .fn()
    .mockResolvedValueOnce({ contentType: "text/turtle" })
    .mockResolvedValueOnce({ contentType: "image/png" });
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response('<#it> <http://purl.org/dc/terms/title> "RDF with no extension".', {
      headers: { "content-type": "text/turtle" },
    }),
  );
  await warmSearchIndex(pod, index, fetch, new AbortController().signal);
  expect(pod.head).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(index.list()).toContain(`${root}rdf`);
  engine.dispose();
});

it("cancels idle work and ignores a listing delivered after account retirement", async () => {
  const engine = createFakeRdfEngine();
  const index = await engine.createIndex();
  const controller = new AbortController();
  let deliver!: (value: ReturnType<typeof page>) => void;
  const list = vi.fn<StorageClient["list"]>(
    () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  );
  const pending = warmSearchIndex(storage(list), index, vi.fn(), controller.signal);
  await vi.waitFor(() => expect(deliver).toBeTypeOf("function"));
  controller.abort();
  deliver(page([entry("private.ttl")]));
  await expect(pending).rejects.toThrow();
  expect(index.list()).toEqual([]);
  const cancelled = new AbortController();
  vi.stubGlobal(
    "requestIdleCallback",
    vi.fn(() => 42),
  );
  const waiting = warmSearchIndex(storage(list), index, vi.fn(), cancelled.signal);
  cancelled.abort();
  await expect(waiting).rejects.toThrow();
  expect(cancelIdleCallback).toHaveBeenCalledWith(42);
  engine.dispose();
});
