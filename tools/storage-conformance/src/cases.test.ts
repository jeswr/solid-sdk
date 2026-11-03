// AUTHORED-BY Codex GPT-6.1-Sol
import { type PageCursor, StorageError } from "@jeswr/storage-client";
import { expect, test, vi } from "vitest";
import { storageCases } from "./cases.js";
import { memoryTarget } from "./targets/memory.js";

const notRdf = storageCases.find((scenario) => scenario.id === "SC-RDF-not-rdf");
if (!notRdf) throw new Error("Missing SC-RDF-not-rdf scenario");

const listingCases = storageCases.filter((scenario) => /^SC-LIST-\d+$/.test(scenario.id));
const list25 = listingCases.find((scenario) => scenario.id === "SC-LIST-25");
if (!list25) throw new Error("Missing SC-LIST-25 scenario");

test.each([10, 100, 2000])("listing scenarios accept LWS page size %i", async (pageSize) => {
  const target = await memoryTarget("lws", { pageSize }).start();
  try {
    expect(target.paginationWitnessSize).toBe(pageSize + 1);
    for (const scenario of listingCases) await scenario.run(target);
  } finally {
    await target.stop();
  }
});

test("configured pagination must occur even when complete single-page listings are correct", async () => {
  const target = await memoryTarget("solid").start();
  target.paginationWitnessSize = 11;
  try {
    await expect(list25.run(target)).rejects.toThrow("Configured pagination witness");
  } finally {
    await target.stop();
  }
});

test.each([
  "empty",
  "partial",
])("rejects an %s terminal list page even with a correct independent listAll", async (fault) => {
  const target = await memoryTarget("solid").start();
  const list = target.storage.list.bind(target.storage);
  // Keep listAll independent of the corrupted public list method.
  vi.spyOn(target.storage, "listAll").mockImplementation(async function* (parent) {
    yield* (await list(parent)).items;
  });
  const broken = vi.spyOn(target.storage, "list").mockImplementation(async (parent) => {
    const page = await list(parent);
    return { ...page, items: page.items.slice(0, fault === "empty" ? 0 : 1), next: null };
  });
  try {
    await expect(list25.run(target)).rejects.toThrow();
    const parent = broken.mock.calls[0]?.[0] as string;
    expect(await Array.fromAsync(target.storage.listAll(parent))).toHaveLength(25);
  } finally {
    await target.stop();
  }
});

test.each([
  "missing",
  "duplicate",
  "repeated-cursor",
  "ignored-cursor",
])("rejects %s during public cursor traversal even with a correct independent listAll", async (fault) => {
  const target = await memoryTarget("lws", { pageSize: 10 }).start();
  const list = target.storage.list.bind(target.storage);
  vi.spyOn(target.storage, "listAll").mockImplementation(async function* (parent) {
    let page = await list(parent);
    for (;;) {
      yield* page.items;
      if (!page.next) break;
      page = await list(parent, { cursor: page.next });
    }
  });
  const broken = vi.spyOn(target.storage, "list").mockImplementation(async (parent, options) => {
    const page = await list(parent, options);
    if (!options?.cursor) return page;
    if (fault === "ignored-cursor") return list(parent);
    if (fault === "repeated-cursor") return { ...page, items: [], next: options.cursor };
    if (fault === "missing") return { ...page, items: page.items.slice(1) };
    const first = await list(parent);
    return { ...page, items: [...page.items, ...first.items] };
  });
  try {
    await expect(list25.run(target)).rejects.toThrow();
    expect(broken.mock.calls.some(([, options]) => options?.cursor)).toBe(true);
    const parent = broken.mock.calls[0]?.[0] as string;
    expect(await Array.fromAsync(target.storage.listAll(parent))).toHaveLength(25);
  } finally {
    await target.stop();
  }
});

test("follows an opaque cursor through an empty page until all members are returned", async () => {
  const target = await memoryTarget("lws", { pageSize: 10 }).start();
  const list = target.storage.list.bind(target.storage);
  const cursor: PageCursor = { url: `${target.root}?opaque=do-not-rewrite%2F` };
  const paged = vi.spyOn(target.storage, "list").mockImplementation(async (parent, options) => {
    if (!options?.cursor) return { items: [], next: cursor, total: null, etag: null };
    return list(parent, options.cursor === cursor ? undefined : options);
  });
  try {
    await list25.run(target);
    expect(paged).toHaveBeenCalledWith(expect.any(String), { cursor });
  } finally {
    await target.stop();
  }
});

test("bounds traversal when a target returns endlessly distinct cursors", async () => {
  const target = await memoryTarget("solid").start();
  let page = 0;
  vi.spyOn(target.storage, "list").mockImplementation(async (parent) => ({
    items: [],
    next: { url: `${parent}?opaque=${++page}` },
    total: null,
    etag: null,
  }));
  try {
    await expect(list25.run(target)).rejects.toThrow("Listing exceeded the page limit");
  } finally {
    await target.stop();
  }
});

test.each([
  "solid",
  "lws",
] as const)("%s opaque storage must reject both non-RDF and malformed RDF reads", async (protocol) => {
  const target = await memoryTarget(protocol).start();
  try {
    const read = vi.spyOn(target.storage, "readRdf");
    await notRdf.run(target);
    expect(read).toHaveBeenCalledTimes(2);
    for (const result of read.mock.results)
      await expect(result.value).rejects.toMatchObject({ code: "not-rdf" });
  } finally {
    await target.stop();
  }
});

test.each([
  400, 422,
])("accepts create-time RDF validation (%i) after asserting the plain-text read error", async (status) => {
  const target = await memoryTarget("solid").start();
  try {
    const create = target.storage.create.bind(target.storage);
    vi.spyOn(target.storage, "create").mockImplementation((parent, body, options) => {
      if (options?.name === "bad.ttl") {
        expect(body).toBe("< invalid turtle");
        expect(options.contentType).toBe("text/turtle");
        throw new StorageError("bad-request", { method: "PUT", url: parent, status });
      }
      return create(parent, body, options);
    });
    const read = vi.spyOn(target.storage, "readRdf");
    await notRdf.run(target);
    expect(read).toHaveBeenCalledOnce();
    await expect(read.mock.results[0]?.value).rejects.toMatchObject({ code: "not-rdf" });
  } finally {
    await target.stop();
  }
});

test.each([
  new Error("transport failed"),
  new StorageError("network", { method: "PUT", url: "https://memory-solid.example/" }),
  new StorageError("forbidden", {
    method: "PUT",
    url: "https://memory-solid.example/",
    status: 403,
  }),
  new StorageError("server", {
    method: "PUT",
    url: "https://memory-solid.example/",
    status: 500,
  }),
  new StorageError("bad-request", { method: "PUT", url: "https://memory-solid.example/" }),
  new StorageError("bad-request", {
    method: "PUT",
    url: "https://memory-solid.example/",
    status: 409,
  }),
])("does not accept an unrelated malformed-RDF create failure (%s)", async (error) => {
  const target = await memoryTarget("solid").start();
  try {
    const create = target.storage.create.bind(target.storage);
    vi.spyOn(target.storage, "create").mockImplementation((parent, body, options) => {
      if (options?.name === "bad.ttl") throw error;
      return create(parent, body, options);
    });
    await expect(notRdf.run(target)).rejects.toThrow();
  } finally {
    await target.stop();
  }
});

test.each([1, 2])("still requires not-rdf on read %i", async (readNumber) => {
  const target = await memoryTarget("solid").start();
  try {
    const readRdf = target.storage.readRdf.bind(target.storage);
    let calls = 0;
    vi.spyOn(target.storage, "readRdf").mockImplementation((url, options) => {
      if (++calls === readNumber) {
        throw new StorageError("bad-request", { method: "GET", url, status: 400 });
      }
      return readRdf(url, options);
    });
    await expect(notRdf.run(target)).rejects.toThrow();
  } finally {
    await target.stop();
  }
});
