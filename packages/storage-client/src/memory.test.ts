// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad } from "@jeswr/fetch-rdf";
import fc from "fast-check";
import { DataFactory, Store } from "n3";
import { describe, expect, test } from "vitest";
import { StorageError } from "./errors.js";
import { createMemoryStorage, type MemoryStorageOptions } from "./memory.js";
import type { Entry, StorageClient } from "./types.js";

const ROOT = "https://memory.example/";
const { namedNode, literal, quad, variable, blankNode } = DataFactory;
const EX = "https://example.org/";
const TURTLE = "text/turtle";

async function collect(iterable: AsyncIterable<Entry>): Promise<string[]> {
  const urls: string[] = [];
  for await (const entry of iterable) urls.push(entry.url);
  return urls;
}

async function rejects(promise: Promise<unknown>, code: string, status?: number | null) {
  const error = await promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code, ...(status === undefined ? {} : { status }) });
  return error as StorageError;
}

const solid = (options: MemoryStorageOptions = {}) => createMemoryStorage(options);
const lws = (options: MemoryStorageOptions = {}) =>
  createMemoryStorage({ protocol: "lws", ...options });

/** The current ETag: ADR-003 §3 allows `'*'` only on write(). */
async function current(storage: StorageClient, url: string) {
  const etag = await storage.head(url).then(
    (result) => result.etag as string,
    () => '"absent"',
  );
  return { ifMatch: etag };
}
async function currentMeta(storage: StorageClient, url: string) {
  return { ifMatch: (await storage.metadata(url)).etag as string };
}

describe("construction and features", () => {
  test("defaults to a Solid storage at memory.example", () => {
    const storage = createMemoryStorage();
    expect(storage).toMatchObject({ protocol: "solid", root: ROOT });
    expect(storage.features).toMatchObject({
      protocol: "solid",
      move: { state: "available", detail: { native: false } },
      patch: { state: "available" },
      // An authoritative description that omits ssd:Pagination leaves it unknown.
      pagination: { state: "unknown" },
    });
    expect(storage.isWithinStorage(`${ROOT}x`)).toBe(true);
    expect(storage.isWithinStorage("https://other.example/x")).toBe(false);
  });

  test("LWS features follow the moveResource toggle", () => {
    // Without lws:MoveResource the description is silent, so move is unknown, not unavailable.
    expect(lws().features.move.state).toBe("unknown");
    expect(lws({ moveResource: true }).features.move).toMatchObject({
      state: "available",
      detail: { native: true, containers: true, preservesIdentifier: false },
    });
    expect(lws().features).toMatchObject({
      pagination: { state: "available" },
      // Recursive delete is advertised only by an ssd:RecursiveDeleteService endpoint
      // (POST {container}); the in-memory backend has none, so the row is unknown even
      // though delete({ recursive: true }) works here.
      recursiveDelete: { state: "unknown" },
    });
  });

  test.each([
    { root: "https://memory.example" },
    { root: "https://memory.example/a?b" },
    { root: "https://MEMORY.example/" },
    { pageSize: 0 },
    { pageSize: 1.5 },
  ])("rejects invalid options %j", (options) => {
    expect(() => createMemoryStorage(options)).toThrow(TypeError);
  });
});

describe("conditional writes (ADR-003 §3)", () => {
  test("unconditional mutations throw TypeError by default, in both modes", async () => {
    for (const storage of [solid(), lws()]) {
      const missing = undefined as unknown as string;
      await expect(
        storage.write(`${ROOT}a`, "x", { contentType: "text/plain", ifMatch: missing }),
      ).rejects.toThrow(TypeError);
      await expect(
        storage.write(`${ROOT}a`, "x", { contentType: "text/plain", ifMatch: "" }),
      ).rejects.toThrow(TypeError);
      await expect(
        storage.patch(`${ROOT}a`, { kind: "json", ops: [] }, { ifMatch: missing }),
      ).rejects.toThrow(TypeError);
      await expect(storage.setMetadata(ROOT, [], { ifMatch: missing })).rejects.toThrow(TypeError);
    }
  });

  test("'*' is accepted only by write(); patch and setMetadata refuse it", async () => {
    for (const storage of [solid(), lws({ strictConditional: false })]) {
      await expect(
        storage.patch(ROOT, { kind: "json", ops: [] }, { ifMatch: "*" }),
      ).rejects.toThrow(/only allowed on write/);
      await expect(storage.setMetadata(ROOT, [], { ifMatch: "*" })).rejects.toThrow(TypeError);
    }
  });

  test("mutations are serialised: two patches with one ETag yield one 412", async () => {
    for (const storage of [solid(), lws()]) {
      const turtle = await storage.create(ROOT, `<${EX}s> <${EX}p> "old" .`, {
        contentType: TURTLE,
        name: "r.ttl",
      });
      const insert = (value: string) =>
        storage.patch(
          turtle.url,
          {
            kind: "rdf",
            inserts: [quad(namedNode(`${EX}s`), namedNode(`${EX}p`), literal(value))],
            deletes: [],
          },
          { ifMatch: turtle.etag as string },
        );
      const results = await Promise.allSettled([insert("a"), insert("b")]);
      expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
      expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
        code: "precondition-failed",
      });
      // A failed mutation does not block the queue.
      const writes = await Promise.allSettled([
        storage.write(`${ROOT}x`, "1", { contentType: "text/plain", ifMatch: '"nope"' }),
        storage.create(ROOT, "2", { contentType: "text/plain" }),
      ]);
      expect(writes.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
    }
  });

  test("non-strict: Solid accepts an unconditional write, LWS answers 428", async () => {
    const missing = undefined as unknown as string;
    const s = solid({ strictConditional: false });
    expect(
      await s.write(`${ROOT}a`, "x", { contentType: "text/plain", ifMatch: missing }),
    ).toMatchObject({
      created: true,
    });
    const l = lws({ strictConditional: false });
    await rejects(
      l.write(`${ROOT}a`, "x", { contentType: "text/plain", ifMatch: missing }),
      "precondition-required",
      428,
    );
  });

  test("Solid: '*' creates or replaces; a stale ETag is 412 with the current ETag", async () => {
    const storage = solid();
    const created = await storage.write(`${ROOT}a/b/c.txt`, "1", {
      contentType: "text/plain",
      ifMatch: "*",
    });
    expect(created).toMatchObject({ url: `${ROOT}a/b/c.txt`, created: true });
    const replaced = await storage.write(`${ROOT}a/b/c.txt`, "2", {
      contentType: "text/plain",
      ifMatch: created.etag as string,
    });
    expect(replaced.created).toBe(false);
    expect(replaced.etag).not.toBe(created.etag);
    const error = await rejects(
      storage.write(`${ROOT}a/b/c.txt`, "3", {
        contentType: "text/plain",
        ifMatch: created.etag as string,
      }),
      "precondition-failed",
      412,
    );
    expect(error.etag).toBe(replaced.etag);
    await rejects(
      storage.write(`${ROOT}nope`, "x", { contentType: "text/plain", ifMatch: '"1"' }),
      "precondition-failed",
    );
    expect(await storage.list(`${ROOT}a/`)).toMatchObject({ total: 1 });
  });

  test("LWS: PUT never creates (404 with '*', 412 with an ETag)", async () => {
    const storage = lws();
    await rejects(
      storage.write(`${ROOT}a`, "x", { contentType: "text/plain", ifMatch: "*" }),
      "not-found",
      404,
    );
    await rejects(
      storage.write(`${ROOT}a`, "x", { contentType: "text/plain", ifMatch: '"1"' }),
      "precondition-failed",
      412,
    );
    const created = await storage.create(ROOT, "x", { contentType: "text/plain", name: "a" });
    expect(
      await storage.write(created.url, "y", { contentType: "text/plain", ifMatch: "*" }),
    ).toMatchObject({
      created: false,
    });
  });

  test("writes need a contentType and never target containers or container/resource twins", async () => {
    const storage = solid();
    await expect(storage.write(`${ROOT}a`, "x", { contentType: "", ifMatch: "*" })).rejects.toThrow(
      TypeError,
    );
    await expect(
      storage.write(
        `${ROOT}a`,
        "x",
        undefined as unknown as { contentType: string; ifMatch: string },
      ),
    ).rejects.toThrow(TypeError);
    await rejects(
      storage.write(`${ROOT}c/`, "x", { contentType: "text/plain", ifMatch: "*" }),
      "method-not-allowed",
      405,
    );
    await storage.create(ROOT, null, { kind: "container", name: "c" });
    await rejects(
      storage.write(`${ROOT}c`, "x", { contentType: "text/plain", ifMatch: "*" }),
      "conflict",
      409,
    );
    await storage.write(`${ROOT}r`, "x", { contentType: "text/plain", ifMatch: "*" });
    await rejects(
      storage.write(`${ROOT}r/child`, "x", { contentType: "text/plain", ifMatch: "*" }),
      "conflict",
      409,
    );
    await rejects(
      storage.write(`${ROOT}r/deeper/child`, "x", { contentType: "text/plain", ifMatch: "*" }),
      "conflict",
      409,
    );
  });

  test("writing below an existing resource used as a container is refused", async () => {
    const storage = solid();
    await storage.write(`${ROOT}file`, "x", { contentType: "text/plain", ifMatch: "*" });
    await rejects(
      storage.write(`${ROOT}file/x`, "x", { contentType: "text/plain", ifMatch: "*" }),
      "conflict",
    );
  });
});

describe("reading", () => {
  test("head/read expose ETag, type, links and permissions (Solid)", async () => {
    const storage = solid({ clock: () => 1_793_000_000_000 });
    const { url, etag } = await storage.write(`${ROOT}notes/a.txt`, "hello", {
      contentType: "text/plain",
      ifMatch: "*",
    });
    const head = await storage.head(url);
    expect(head).toMatchObject({
      url,
      status: 200,
      etag,
      contentType: "text/plain",
      body: null,
      parent: `${ROOT}notes/`,
      metadataUrl: `${url}.meta`,
      kind: "resource",
      allow: { read: true, write: true, append: true, control: true },
    });
    expect(head.lastModified?.getTime()).toBe(1_793_000_000_000);
    expect(await head.bytes()).toEqual(new Uint8Array());
    expect(head.links.get("describedby")).toEqual([{ target: `${url}.meta`, params: {} }]);
    const read = await storage.read(url);
    expect(await read.text()).toBe("hello");
    expect(await new Response(read.body).text()).toBe("hello");
    expect((await read.blob()).type).toBe("text/plain");
    expect(await (await read.blob()).text()).toBe("hello");
    expect([...(await read.bytes())]).toEqual([...new TextEncoder().encode("hello")]);
    const rootHead = await storage.head(ROOT);
    expect(rootHead.links.get("type")?.map((link) => link.target)).toContain(
      "http://www.w3.org/ns/pim/space#Storage",
    );
    expect(rootHead.parent).toBeNull();
  });

  test("conditional and ranged reads", async () => {
    const storage = solid();
    const { url, etag } = await storage.write(`${ROOT}a`, "0123456789", {
      contentType: "text/plain",
      ifMatch: "*",
    });
    expect(await storage.read(url, { ifNoneMatch: etag as string })).toMatchObject({
      status: 304,
      body: null,
    });
    expect(await storage.read(url, { ifNoneMatch: "*" })).toMatchObject({ status: 304 });
    expect((await storage.read(url, { ifNoneMatch: '"other"' })).status).toBe(200);
    const partial = await storage.read(url, { range: { start: 2, end: 4 } });
    expect(partial.status).toBe(206);
    expect(await partial.text()).toBe("234");
    expect(await (await storage.read(url, { range: { start: 7 } })).text()).toBe("789");
    expect(await (await storage.read(url, { range: { start: 8, end: 99 } })).text()).toBe("89");
    for (const range of [
      { start: 10 },
      { start: -1 },
      { start: 3, end: 2 },
      { start: 0.5 },
      { start: 0, end: 1.5 },
    ]) {
      await rejects(storage.read(url, { range }), "bad-request", 416);
    }
    const blob = await (await storage.read(url, { ifNoneMatch: "*" })).blob();
    expect(blob.size).toBe(0);
  });

  test("Solid containers read as Turtle listings; LWS as lws+json", async () => {
    const s = solid();
    await s.write(`${ROOT}c/x`, "x", { contentType: "text/plain", ifMatch: "*" });
    const listing = await s.readRdf(`${ROOT}c/`);
    expect(listing.contentType).toBe(TURTLE);
    expect(
      listing.dataset.has(
        quad(
          namedNode(`${ROOT}c/`),
          namedNode("http://www.w3.org/ns/ldp#contains"),
          namedNode(`${ROOT}c/x`),
        ),
      ),
    ).toBe(true);
    const l = lws();
    const container = await l.create(ROOT, null, { kind: "container", name: "c" });
    await l.create(container.url, "{}", { contentType: "application/json", name: "a" });
    await l.create(container.url, null, { kind: "container", name: "b" });
    const read = await l.read(container.url);
    expect(read.contentType).toBe("application/lws+json");
    expect(JSON.parse(await read.text())).toMatchObject({
      id: container.url,
      type: "Container",
      totalItems: 2,
      items: [
        { id: `${container.url}a`, type: "DataResource", format: "application/json", size: 2 },
        { id: `${container.url}b/`, type: "Container" },
      ],
    });
    expect((await l.head(container.url)).links.get("type")).toEqual([
      { target: "https://www.w3.org/ns/lws#Container", params: {} },
    ]);
    await rejects(l.readRdf(container.url), "not-rdf");
  });

  test("readRdf parses RDF, refuses other types and malformed bodies, and reports 304", async () => {
    const storage = solid();
    const { url, etag } = await storage.write(`${ROOT}d.ttl`, `<${EX}s> <${EX}p> "o" .`, {
      contentType: "text/turtle; charset=utf-8",
      ifMatch: "*",
    });
    const result = await storage.readRdf(url);
    expect(result).toMatchObject({ url, etag, contentType: TURTLE });
    expect(result.dataset.size).toBe(1);
    expect(await storage.readRdf(url, { ifNoneMatch: etag as string })).toMatchObject({
      notModified: true,
      etag,
    });
    await storage.write(`${ROOT}t.txt`, "x", { contentType: "text/plain", ifMatch: "*" });
    await rejects(storage.readRdf(`${ROOT}t.txt`), "not-rdf");
    await storage.write(`${ROOT}bad.ttl`, "<unterminated", { contentType: TURTLE, ifMatch: "*" });
    await rejects(storage.readRdf(`${ROOT}bad.ttl`), "not-rdf");
    await storage.write(`${ROOT}untyped`, "x", { contentType: "x", ifMatch: "*" });
    await rejects(storage.readRdf(`${ROOT}untyped`), "not-rdf");
  });

  test("missing resources, foreign URLs and aborted signals", async () => {
    const storage = solid();
    await rejects(storage.read(`${ROOT}missing`), "not-found", 404);
    await rejects(storage.head("https://other.example/x"), "scope", null);
    const controller = new AbortController();
    controller.abort();
    await rejects(storage.read(ROOT, { signal: controller.signal }), "network");
    await rejects(storage.list(`${ROOT}missing/`), "not-found");
  });
});

describe("create", () => {
  test("Solid honours names, refuses clashes and invalid names, and slugs otherwise", async () => {
    const storage = solid();
    const named = await storage.create(ROOT, "x", { contentType: "text/plain", name: "a b" });
    expect(named).toMatchObject({ url: `${ROOT}a%20b`, created: true });
    await rejects(
      storage.create(ROOT, "x", { contentType: "text/plain", name: "a b" }),
      "conflict",
      409,
    );
    await rejects(storage.create(ROOT, null, { kind: "container", name: "a b" }), "conflict", 409);
    const slugged = await storage.create(ROOT, "x", { contentType: "text/plain" });
    expect(slugged.url).toMatch(/^https:\/\/memory\.example\/[a-z2-7]{16}$/);
    const folder = await storage.create(ROOT, null, { kind: "container", name: "folder" });
    expect(folder.url).toBe(`${ROOT}folder/`);
    await rejects(
      storage.create(ROOT, "x", { contentType: "text/plain", name: "folder" }),
      "conflict",
    );
    for (const name of ["", ".", "..", "a\u0001b"]) {
      await rejects(
        storage.create(ROOT, "x", { contentType: "text/plain", name }),
        "bad-request",
        400,
      );
    }
    expect((await storage.create(ROOT, "x", { contentType: "text/plain", name: "a/b" })).url).toBe(
      `${ROOT}a%2Fb`,
    );
  });

  test("resources require a contentType; containers ignore bodies; parents must be containers", async () => {
    const storage = solid();
    await expect(storage.create(ROOT, "x")).rejects.toThrow(TypeError);
    await expect(storage.create(ROOT, "x", { contentType: "" })).rejects.toThrow(TypeError);
    const container = await storage.create(ROOT, "ignored", { kind: "container" });
    expect(await (await storage.read(container.url)).text()).not.toContain("ignored");
    const resource = await storage.create(ROOT, null, { contentType: "text/plain" });
    expect(await (await storage.read(resource.url)).text()).toBe("");
    await rejects(
      storage.create(resource.url, "x", { contentType: "text/plain" }),
      "method-not-allowed",
      405,
    );
    await rejects(
      storage.create(`${ROOT}missing/`, "x", { contentType: "text/plain" }),
      "not-found",
    );
  });

  test("LWS treats the name as a hint and keeps type/user links", async () => {
    const storage = lws();
    const first = await storage.create(ROOT, "{}", {
      contentType: "application/json",
      name: "doc",
      links: [
        { rel: "type", target: `${EX}Note` },
        { rel: "describedby", target: `${EX}profile` },
        { rel: "up", target: `${EX}ignored` },
      ],
    });
    const second = await storage.create(ROOT, "{}", {
      contentType: "application/json",
      name: "doc",
    });
    expect(first.url).toBe(`${ROOT}doc`);
    expect(second.url).toBe(`${ROOT}doc-1`);
    const head = await storage.head(first.url);
    expect(head.links.get("type")?.map((link) => link.target)).toEqual([
      "https://www.w3.org/ns/lws#DataResource",
      `${EX}Note`,
    ]);
    expect(head).toMatchObject({ parent: ROOT, metadataUrl: `${first.url}.linkset`, allow: null });
    const listing = await storage.list(ROOT);
    expect(listing.items.find((entry) => entry.url === first.url)?.types).toEqual([`${EX}Note`]);
    const metadata = await storage.metadata(first.url);
    expect(metadata.links.get(first.url)?.get("describedby")).toEqual([
      { href: `${EX}profile`, params: {} },
    ]);
    expect(metadata.links.get(first.url)?.get("up")).toEqual([{ href: ROOT, params: {} }]);
    const container = await storage.create(ROOT, null, { kind: "container", name: "doc" });
    expect(container.url).toBe(`${ROOT}doc-2/`);
  });
});

describe("listing and pagination (ADR-003 §4)", () => {
  test("Solid lists one page with total and container ETag; cursors are refused", async () => {
    const storage = solid();
    await storage.create(ROOT, "x", { contentType: "text/plain", name: "b" });
    await storage.create(ROOT, null, { kind: "container", name: "a" });
    const page = await storage.list(ROOT);
    expect(page).toMatchObject({ next: null, total: 2, etag: (await storage.head(ROOT)).etag });
    expect(page.items).toEqual([
      {
        url: `${ROOT}a/`,
        kind: "container",
        contentType: null,
        size: null,
        modified: expect.any(Date),
        types: [],
      },
      {
        url: `${ROOT}b`,
        kind: "resource",
        contentType: "text/plain",
        size: 1,
        modified: expect.any(Date),
        types: [],
      },
    ]);
    await rejects(storage.list(ROOT, { cursor: { url: `${ROOT}?page=2` } }), "bad-request");
    await rejects(storage.list(`${ROOT}b`), "method-not-allowed");
  });

  test("LWS pages by pageSize and listAll follows next", async () => {
    const storage = lws({ pageSize: 2 });
    for (const name of ["a", "b", "c", "d", "e"]) {
      await storage.create(ROOT, "x", { contentType: "text/plain", name });
    }
    const first = await storage.list(ROOT);
    expect(first).toMatchObject({ total: 5, next: { url: `${ROOT}?page=2` } });
    expect(first.items.map((entry) => entry.url)).toEqual([`${ROOT}a`, `${ROOT}b`]);
    const last = await storage.list(ROOT, { cursor: { url: `${ROOT}?page=3` } });
    expect(last).toMatchObject({ next: null });
    expect(await collect(storage.listAll(ROOT))).toEqual(
      ["a", "b", "c", "d", "e"].map((n) => `${ROOT}${n}`),
    );
    for (const url of [
      `${ROOT}?page=0`,
      `${ROOT}other?page=2`,
      "https://x/?page=2",
      `${ROOT}?page=x`,
    ]) {
      await rejects(storage.list(ROOT, { cursor: { url } }), "bad-request");
    }
  });

  test("container ETags change on membership changes only", async () => {
    const storage = lws();
    const before = (await storage.head(ROOT)).etag;
    const created = await storage.create(ROOT, "x", { contentType: "text/plain" });
    const afterCreate = (await storage.head(ROOT)).etag;
    expect(afterCreate).not.toBe(before);
    await storage.write(created.url, "y", {
      contentType: "text/plain",
      ifMatch: created.etag as string,
    });
    expect((await storage.head(ROOT)).etag).toBe(afterCreate);
    await storage.delete(created.url, await current(storage, created.url));
    expect((await storage.head(ROOT)).etag).not.toBe(afterCreate);
  });
});

describe("patch", () => {
  const s = namedNode(`${EX}s`);
  const p = namedNode(`${EX}p`);

  async function ttl(storage: StorageClient) {
    return storage.write(`${ROOT}d.ttl`, `<${EX}s> <${EX}p> "old" .`, {
      contentType: TURTLE,
      ifMatch: "*",
    });
  }

  test("RDF inserts/deletes apply atomically and bump the ETag", async () => {
    const storage = solid();
    const { url, etag } = await ttl(storage);
    const result = await storage.patch(
      url,
      {
        kind: "rdf",
        deletes: [quad(s, p, literal("old"))],
        inserts: [quad(s, p, literal("new")), quad(s, p, blankNode())],
      },
      { ifMatch: etag as string },
    );
    expect(result).toMatchObject({ url, created: false });
    const { dataset } = await storage.readRdf(url);
    expect(dataset.has(quad(s, p, literal("new")))).toBe(true);
    expect(dataset.has(quad(s, p, literal("old")))).toBe(false);
    await rejects(
      storage.patch(url, { kind: "rdf", deletes: [], inserts: [] }, { ifMatch: etag as string }),
      "precondition-failed",
      412,
    );
    expect(
      await storage.patch(
        url,
        { kind: "rdf", deletes: [], inserts: [], where: [] },
        await current(storage, url),
      ),
    ).toMatchObject({
      created: false,
    });
  });

  test("RDF patch failures map to conflict, bad-request, unsupported and 415", async () => {
    const storage = solid();
    const { url } = await ttl(storage);
    await rejects(
      storage.patch(
        url,
        { kind: "rdf", deletes: [quad(s, p, literal("absent"))], inserts: [] },
        await current(storage, url),
      ),
      "conflict",
      409,
    );
    await rejects(
      storage.patch(
        url,
        {
          kind: "rdf",
          deletes: [],
          inserts: [quad(s, p, variable("v") as unknown as Quad["object"])],
        },
        await current(storage, url),
      ),
      "bad-request",
      422,
    );
    await rejects(
      storage.patch(
        url,
        { kind: "rdf", deletes: [quad(s, p, blankNode())], inserts: [] },
        await current(storage, url),
      ),
      "bad-request",
    );
    const unsupported = await rejects(
      storage.patch(
        url,
        {
          kind: "rdf",
          deletes: [],
          inserts: [],
          where: [quad(s, p, variable("o") as unknown as Quad["object"])],
        },
        await current(storage, url),
      ),
      "unsupported",
      null,
    );
    expect(unsupported.feature).toBe("patch");
    await storage.write(`${ROOT}j.json`, "{}", { contentType: "application/json", ifMatch: "*" });
    await rejects(
      storage.patch(
        `${ROOT}j.json`,
        { kind: "rdf", deletes: [], inserts: [] },
        await current(storage, `${ROOT}j.json`),
      ),
      "unsupported-media-type",
      415,
    );
    await storage.write(`${ROOT}l.jsonld`, "{}", {
      contentType: "application/ld+json",
      ifMatch: "*",
    });
    await rejects(
      storage.patch(
        `${ROOT}l.jsonld`,
        { kind: "rdf", deletes: [], inserts: [] },
        await current(storage, `${ROOT}l.jsonld`),
      ),
      "unsupported-media-type",
    );
    await storage.write(`${ROOT}bad.ttl`, "<oops", { contentType: TURTLE, ifMatch: "*" });
    await rejects(
      storage.patch(
        `${ROOT}bad.ttl`,
        { kind: "rdf", deletes: [], inserts: [] },
        await current(storage, `${ROOT}bad.ttl`),
      ),
      "conflict",
    );
    await rejects(
      storage.patch(ROOT, { kind: "rdf", deletes: [], inserts: [] }, await current(storage, ROOT)),
      "method-not-allowed",
    );
    await rejects(
      storage.patch(
        `${ROOT}missing`,
        { kind: "rdf", deletes: [], inserts: [] },
        { ifMatch: '"0"' },
      ),
      "not-found",
    );
  });

  test("JSON Patch on JSON resources, via kind json or raw application/json-patch+json", async () => {
    const storage = lws();
    const { url, etag } = await storage.create(ROOT, '{"a":1}', {
      contentType: "application/vnd.x+json",
      name: "j",
    });
    const next = await storage.patch(
      url,
      { kind: "json", ops: [{ op: "replace", path: "/a", value: 2 }] },
      { ifMatch: etag as string },
    );
    expect(JSON.parse(await (await storage.read(url)).text())).toEqual({ a: 2 });
    await storage.patch(
      url,
      {
        kind: "raw",
        mediaType: "application/json-patch+json; charset=utf-8",
        body: '[{"op":"add","path":"/b","value":true}]',
      },
      { ifMatch: next.etag as string },
    );
    expect(JSON.parse(await (await storage.read(url)).text())).toEqual({ a: 2, b: true });
    await rejects(
      storage.patch(
        url,
        { kind: "json", ops: [{ op: "test", path: "/a", value: 3 }] },
        await current(storage, url),
      ),
      "conflict",
      409,
    );
    await rejects(
      storage.patch(
        url,
        { kind: "json", ops: [{ op: "bogus", path: "/a" } as never] },
        await current(storage, url),
      ),
      "bad-request",
      400,
    );
    await rejects(
      storage.patch(
        url,
        { kind: "raw", mediaType: "application/json-patch+json", body: "{" },
        await current(storage, url),
      ),
      "bad-request",
    );
    await rejects(
      storage.patch(
        url,
        { kind: "raw", mediaType: "text/n3", body: "" },
        await current(storage, url),
      ),
      "unsupported-media-type",
      415,
    );
    const text = await storage.create(ROOT, "plain", { contentType: "text/plain" });
    await rejects(
      storage.patch(text.url, { kind: "json", ops: [] }, await current(storage, text.url)),
      "unsupported-media-type",
    );
    const broken = await storage.create(ROOT, "{", { contentType: "application/json" });
    await rejects(
      storage.patch(broken.url, { kind: "json", ops: [] }, await current(storage, broken.url)),
      "conflict",
    );
  });
});

describe("move", () => {
  test("Solid emulates move with a new URL; names, clashes, cycles and the root", async () => {
    const storage = solid();
    await storage.write(`${ROOT}src/doc.txt`, "x", { contentType: "text/plain", ifMatch: "*" });
    await storage.write(`${ROOT}src/sub/deep.txt`, "y", {
      contentType: "text/plain",
      ifMatch: "*",
    });
    await storage.create(ROOT, null, { kind: "container", name: "dst" });
    const moved = await storage.move(
      `${ROOT}src/doc.txt`,
      `${ROOT}dst/`,
      await current(storage, `${ROOT}src/doc.txt`),
    );
    expect(moved).toMatchObject({ url: `${ROOT}dst/doc.txt`, created: true });
    await rejects(storage.read(`${ROOT}src/doc.txt`), "not-found");
    const renamed = await storage.move(`${ROOT}dst/doc.txt`, `${ROOT}dst/`, {
      name: "renamed.txt",
      ...(await current(storage, `${ROOT}dst/doc.txt`)),
    });
    expect(renamed.url).toBe(`${ROOT}dst/renamed.txt`);
    const tree = await storage.move(
      `${ROOT}src/`,
      `${ROOT}dst/`,
      await current(storage, `${ROOT}src/`),
    );
    expect(tree.url).toBe(`${ROOT}dst/src/`);
    expect(await (await storage.read(`${ROOT}dst/src/sub/deep.txt`)).text()).toBe("y");
    expect(await storage.parentOf(`${ROOT}dst/src/sub/deep.txt`)).toBe(`${ROOT}dst/src/sub/`);
    await storage.write(`${ROOT}clash.txt`, "x", { contentType: "text/plain", ifMatch: "*" });
    await rejects(
      storage.move(`${ROOT}clash.txt`, `${ROOT}dst/`, {
        name: "renamed.txt",
        ...(await current(storage, `${ROOT}clash.txt`)),
      }),
      "conflict",
      409,
    );
    await rejects(
      storage.move(`${ROOT}dst/`, `${ROOT}dst/src/`, await current(storage, `${ROOT}dst/`)),
      "conflict",
      409,
    );
    await rejects(
      storage.move(ROOT, `${ROOT}dst/`, await current(storage, ROOT)),
      "method-not-allowed",
      405,
    );
    await rejects(
      storage.move(`${ROOT}clash.txt`, `${ROOT}dst/`, { ifMatch: '"stale"' }),
      "precondition-failed",
    );
    await rejects(
      storage.move(
        `${ROOT}clash.txt`,
        `${ROOT}clash.txt`,
        await current(storage, `${ROOT}clash.txt`),
      ),
      "method-not-allowed",
    );
    await rejects(
      storage.move(
        `${ROOT}clash.txt`,
        "https://other.example/",
        await current(storage, `${ROOT}clash.txt`),
      ),
      "scope",
    );
  });

  test("Solid caps emulated container moves at 2000 resources", async () => {
    const storage = solid();
    for (let i = 0; i < 2_000; i++) {
      await storage.write(`${ROOT}big/${i}`, "x", { contentType: "text/plain", ifMatch: "*" });
    }
    await storage.create(ROOT, null, { kind: "container", name: "dst" });
    const error = await rejects(
      storage.move(`${ROOT}big/`, `${ROOT}dst/`, await current(storage, `${ROOT}big/`)),
      "unsupported",
    );
    expect(error.feature).toBe("move");
  });

  test("LWS: unsupported without MoveResource; server-named and metadata-carrying with it", async () => {
    const without = lws();
    const doc = await without.create(ROOT, "x", { contentType: "text/plain", name: "doc" });
    const error = await rejects(without.move(doc.url, ROOT), "unsupported", null);
    expect(error.feature).toBe("move");

    const storage = lws({ moveResource: true });
    const a = await storage.create(ROOT, null, { kind: "container", name: "a" });
    const b = await storage.create(ROOT, null, { kind: "container", name: "b" });
    const file = await storage.create(a.url, "x", {
      contentType: "text/plain",
      name: "f",
      links: [{ rel: "describedby", target: `${EX}d` }],
    });
    await storage.create(b.url, "x", { contentType: "text/plain", name: "f" });
    await storage.setMetadata(
      file.url,
      [{ op: "add", anchor: ROOT, rel: "describedby", href: `${EX}r` }],
      await currentMeta(storage, file.url),
    );
    const moved = await storage.move(file.url, b.url, {
      name: "ignored",
      ...(await current(storage, file.url)),
    });
    expect((await storage.metadata(moved.url)).links.get(ROOT)?.get("describedby")).toEqual([
      { href: `${EX}r`, params: {} },
    ]);
    expect(moved.url).toBe(`${b.url}f-1`);
    expect(await storage.parentOf(moved.url)).toBe(b.url);
    expect((await storage.metadata(moved.url)).links.get(moved.url)?.get("describedby")).toEqual([
      { href: `${EX}d`, params: {} },
    ]);
  });
});

describe("delete", () => {
  test("respects ETags, refuses the root and non-empty containers unless recursive", async () => {
    const storage = solid();
    const { url, etag } = await storage.write(`${ROOT}c/a`, "x", {
      contentType: "text/plain",
      ifMatch: "*",
    });
    await rejects(storage.delete(url, { ifMatch: '"stale"' }), "precondition-failed", 412);
    await rejects(
      storage.delete(`${ROOT}c/`, await current(storage, `${ROOT}c/`)),
      "conflict",
      409,
    );
    await rejects(storage.delete(ROOT, await current(storage, ROOT)), "method-not-allowed", 405);
    await storage.delete(url, { ifMatch: etag as string });
    await storage.write(`${ROOT}c/b/x`, "x", { contentType: "text/plain", ifMatch: "*" });
    await storage.delete(`${ROOT}c/`, {
      recursive: true,
      ...(await current(storage, `${ROOT}c/`)),
    });
    await rejects(storage.head(`${ROOT}c/b/x`), "not-found");
    await rejects(storage.delete(`${ROOT}c/`, await current(storage, `${ROOT}c/`)), "not-found");
  });
});

describe("metadata", () => {
  test("Solid: describedby document as RDF, registered rels mapped to IANA IRIs", async () => {
    const storage = solid();
    const { url } = await storage.write(`${ROOT}a`, "x", {
      contentType: "text/plain",
      ifMatch: "*",
    });
    const empty = await storage.metadata(url);
    expect(empty).toMatchObject({ url: `${url}.meta` });
    expect(empty.raw).toBeInstanceOf(Store);
    const { etag } = await storage.setMetadata(
      url,
      [
        { op: "add", rel: "license", href: `${EX}license` },
        { op: "add", rel: `${EX}rel`, href: `${EX}x` },
        { op: "add", rel: `${EX}rel`, href: `${EX}x` },
        { op: "add", anchor: `${ROOT}a#frag`, rel: `${EX}rel`, href: `${EX}y` },
      ],
      { ifMatch: empty.etag as string },
    );
    const metadata = await storage.metadata(url);
    expect(metadata.etag).toBe(etag);
    expect(
      metadata.links.get(url)?.get("http://www.iana.org/assignments/relation/license"),
    ).toEqual([{ href: `${EX}license`, params: {} }]);
    expect(metadata.links.get(url)?.get(`${EX}rel`)).toHaveLength(1);
    expect(metadata.links.get(`${ROOT}a#frag`)?.get(`${EX}rel`)).toHaveLength(1);
    expect((metadata.raw as Store).size).toBe(3);
    await rejects(
      storage.setMetadata(url, [], { ifMatch: empty.etag as string }),
      "precondition-failed",
      412,
    );
    await storage.setMetadata(
      url,
      [
        { op: "remove", rel: "license", href: `${EX}license` },
        { op: "remove", rel: "x", href: "y" },
      ],
      await currentMeta(storage, url),
    );
    expect(
      (await storage.metadata(url)).links
        .get(url)
        ?.has("http://www.iana.org/assignments/relation/license"),
    ).toBe(false);
    await rejects(
      storage.setMetadata(
        url,
        [{ op: "add", anchor: "https://other.example/", rel: "x", href: "y" }],
        await currentMeta(storage, url),
      ),
      "scope",
    );
  });

  test("LWS: linkset with up/type; server-managed rels refused", async () => {
    const storage = lws();
    const { url } = await storage.create(ROOT, "x", { contentType: "text/plain", name: "a" });
    const metadata = await storage.metadata(url);
    expect(metadata.url).toBe(`${url}.linkset`);
    expect(metadata.raw).toEqual({
      linkset: [
        {
          anchor: url,
          type: [{ href: "https://www.w3.org/ns/lws#DataResource" }],
          up: [{ href: ROOT }],
        },
      ],
    });
    await storage.setMetadata(url, [{ op: "add", rel: "describedby", href: `${EX}d` }], {
      ifMatch: metadata.etag as string,
    });
    expect((await storage.metadata(url)).links.get(url)?.get("describedby")).toEqual([
      { href: `${EX}d`, params: {} },
    ]);
    const up = await rejects(
      storage.setMetadata(
        url,
        [{ op: "add", rel: "up", href: ROOT }],
        await currentMeta(storage, url),
      ),
      "unsupported",
    );
    expect(up.feature).toBe("move");
    const type = await rejects(
      storage.setMetadata(
        url,
        [{ op: "add", rel: "type", href: ROOT }],
        await currentMeta(storage, url),
      ),
      "unsupported",
    );
    expect(type.feature).toBeUndefined();
    const rootMetadata = await storage.metadata(ROOT);
    expect(rootMetadata.links.get(ROOT)?.has("up")).toBe(false);
    await rejects(storage.metadata(`${ROOT}missing`), "not-found");
  });
});

describe("parentOf", () => {
  test("Solid uses path arithmetic without lookup; LWS needs the resource", async () => {
    expect(await solid().parentOf(`${ROOT}not/there`)).toBe(`${ROOT}not/`);
    expect(await solid().parentOf(ROOT)).toBeNull();
    await rejects(lws().parentOf(`${ROOT}not/there`), "not-found");
    expect(await lws().parentOf(ROOT)).toBeNull();
  });
});

describe("properties (ADR-003 §10)", () => {
  test("list after create×n returns n (both protocols, any page size)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("solid" as const, "lws" as const),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 1, max: 7 }),
        async (protocol, n, pageSize) => {
          const storage = createMemoryStorage({ protocol, pageSize });
          for (let i = 0; i < n; i++)
            await storage.create(ROOT, `${i}`, { contentType: "text/plain" });
          expect((await storage.list(ROOT)).total).toBe(n);
          expect(await collect(storage.listAll(ROOT))).toHaveLength(n);
        },
      ),
      { numRuns: 40 },
    );
  });

  test("write with a stale ETag is always 412", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("solid" as const, "lws" as const),
        fc.array(fc.string(), { minLength: 1, maxLength: 5 }),
        async (protocol, bodies) => {
          const storage = createMemoryStorage({ protocol });
          const created = await storage.create(ROOT, "seed", { contentType: "text/plain" });
          const stale = created.etag as string;
          let current = stale;
          for (const body of bodies) {
            current = (
              await storage.write(created.url, body, {
                contentType: "text/plain",
                ifMatch: current,
              })
            ).etag as string;
          }
          await rejects(
            storage.write(created.url, "late", { contentType: "text/plain", ifMatch: stale }),
            "precondition-failed",
            412,
          );
        },
      ),
      { numRuns: 40 },
    );
  });

  test("LWS mode: an unconditional PUT (non-strict) is always 428", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.boolean(), async (body, exists) => {
        const storage = createMemoryStorage({ protocol: "lws", strictConditional: false });
        const url = exists
          ? (await storage.create(ROOT, "x", { contentType: "text/plain" })).url
          : `${ROOT}new`;
        await rejects(
          storage.write(url, body, {
            contentType: "text/plain",
            ifMatch: undefined as unknown as string,
          }),
          "precondition-required",
          428,
        );
      }),
      { numRuns: 30 },
    );
  });
});

describe("writeRdf", () => {
  test("serialises Turtle (default) and N-Triples; unknown formats are unsupported", async () => {
    const storage = solid();
    const dataset = new Store([quad(namedNode(`${EX}s`), namedNode(`${EX}p`), literal("o"))]);
    const written = await storage.writeRdf(`${ROOT}d.ttl`, dataset, {
      ifMatch: "*",
      prefixes: { ex: EX },
    });
    expect(written.created).toBe(true);
    expect(await (await storage.read(`${ROOT}d.ttl`)).text()).toContain("@prefix ex:");
    await storage.writeRdf(`${ROOT}d.nt`, [...dataset], {
      ifMatch: "*",
      contentType: "application/n-triples" as "text/turtle",
    });
    expect((await storage.head(`${ROOT}d.nt`)).contentType).toBe("application/n-triples");
    const error = await rejects(
      storage.writeRdf(`${ROOT}d.jsonld`, dataset, {
        ifMatch: "*",
        contentType: "application/rdf+xml" as "text/turtle",
      }),
      "unsupported",
    );
    expect(error.feature).toBe("rdfConneg");
    await expect(storage.writeRdf(`${ROOT}x.ttl`, dataset, undefined as never)).rejects.toThrow(
      TypeError,
    );
  });

  test.each([
    "solid",
    "lws",
  ] as const)("%s writes JSON-LD with graphs and the correct content type", async (protocol) => {
    const storage = createMemoryStorage({ protocol });
    const url =
      protocol === "solid"
        ? `${ROOT}d.jsonld`
        : (await storage.create(ROOT, "[]", { contentType: "application/ld+json" })).url;
    const s = namedNode(`${EX}s`);
    const p = namedNode(`${EX}p`);
    const blank = blankNode("unsafe . label");
    const dataset = new Store([
      quad(s, p, literal("https://example.org/literal 日本語 😀")),
      quad(s, p, blank),
      quad(blank, p, literal("bonjour", "fr"), namedNode(`${EX}graph`)),
    ]);
    const written = await storage.writeRdf(url, dataset, {
      ifMatch: protocol === "solid" ? "*" : ((await storage.head(url)).etag as string),
      contentType: "application/ld+json",
      prefixes: { ex: EX },
    });
    const read = await storage.read(url);
    expect(read.contentType).toBe("application/ld+json");
    expect(read.etag).toBe(written.etag);
    const body = await read.text();
    expect(JSON.parse(body)).toEqual([
      {
        "@id": s.value,
        [p.value]: [{ "@value": "https://example.org/literal 日本語 😀" }, { "@id": "_:b0" }],
      },
      {
        "@id": `${EX}graph`,
        "@graph": [{ "@id": "_:b0", [p.value]: [{ "@value": "bonjour", "@language": "fr" }] }],
      },
    ]);
    const parsed = (await storage.readRdf(url)).dataset;
    expect(parsed.size).toBe(3);
    const blankObject = [...parsed].find((q) => q.object.termType === "BlankNode")?.object;
    const namedGraphQuad = [...parsed].find((q) => q.graph.value === `${EX}graph`);
    expect(namedGraphQuad?.subject.equals(blankObject as Quad["object"])).toBe(true);
    expect(namedGraphQuad?.object.value).toBe("bonjour");

    await rejects(
      storage.writeRdf(url, [], { ifMatch: '"stale"', contentType: "application/ld+json" }),
      "precondition-failed",
      412,
    );
    expect((await storage.head(url)).etag).toBe(written.etag);
    await storage.writeRdf(url, [], {
      ifMatch: written.etag as string,
      contentType: "application/ld+json",
    });
    expect(await (await storage.read(url)).text()).toBe("[]");
    expect((await storage.readRdf(url)).dataset.size).toBe(0);
  });

  test("JSON-LD validation failures never commit a partial write", async () => {
    const storage = solid();
    const url = `${ROOT}d.jsonld`;
    const { etag } = await storage.writeRdf(url, [], {
      ifMatch: "*",
      contentType: "application/ld+json",
    });
    const directed = quad(namedNode(`${EX}s`), namedNode(`${EX}p`), literal("مرحبا", "ar--rtl"));
    await expect(
      storage.writeRdf(url, [directed], {
        ifMatch: etag as string,
        contentType: "application/ld+json",
      }),
    ).rejects.toThrow(TypeError);
    expect((await storage.head(url)).etag).toBe(etag);
    expect(await (await storage.read(url)).text()).toBe("[]");
    await expect(
      storage.writeRdf(`${ROOT}missing.jsonld`, [directed], {
        ifMatch: "*",
        contentType: "application/ld+json",
      }),
    ).rejects.toThrow(TypeError);
    await rejects(storage.head(`${ROOT}missing.jsonld`), "not-found");
  });
});

describe("review round 1 regressions", () => {
  test("move and delete require ifMatch and refuse '*' in strict mode", async () => {
    for (const storage of [solid(), lws({ moveResource: true })]) {
      const file = await storage.create(ROOT, "x", { contentType: "text/plain" });
      const missing = undefined as unknown as string;
      await expect(storage.delete(file.url)).rejects.toThrow(TypeError);
      await expect(storage.delete(file.url, { ifMatch: "*" })).rejects.toThrow(TypeError);
      await expect(storage.move(file.url, ROOT, { ifMatch: missing })).rejects.toThrow(TypeError);
      await expect(storage.move(file.url, ROOT, { ifMatch: "*" })).rejects.toThrow(TypeError);
    }
    // Non-strict Solid lets an unconditional delete through, like a server without preconditions.
    const loose = solid({ strictConditional: false });
    const file = await loose.create(ROOT, "x", { contentType: "text/plain" });
    await loose.delete(file.url);
    await rejects(loose.head(file.url), "not-found");
  });

  test("reads pair bytes with the ETag of the same state", async () => {
    for (const storage of [solid(), lws()]) {
      const parent = await storage.create(ROOT, null, { kind: "container", name: "c" });
      const reading = storage.read(parent.url);
      const created = storage.create(parent.url, "x", { contentType: "text/plain", name: "n" });
      const [result] = await Promise.all([reading, created]);
      expect(result.etag).toBe(parent.etag);
      expect(await result.text()).not.toContain(`${parent.url}n`);
    }
  });

  test("LWS container reads are paged with rel=next, and page URLs are readable", async () => {
    const storage = lws({ pageSize: 1 });
    await storage.create(ROOT, "1", { contentType: "text/plain", name: "a" });
    await storage.create(ROOT, "2", { contentType: "text/plain", name: "b" });
    const first = await storage.read(ROOT);
    const next = first.links.get("next")?.[0]?.target as string;
    expect(next).toBe(`${ROOT}?page=2`);
    const second = await storage.read(next);
    expect(second.url).toBe(next);
    expect(JSON.parse(await second.text())).toMatchObject({ totalItems: 2, items: [{}] });
    expect(second.links.has("next")).toBe(false);
    expect((await storage.head(ROOT)).links.has("next")).toBe(true);
    await rejects(storage.read(`${ROOT}a?page=2`), "not-found", 404);
    await rejects(storage.read(`${ROOT}missing/?page=2`), "not-found", 404);
    // Solid has no paged reads: the query is part of an unknown URL.
    await rejects(solid().read(`${ROOT}?page=2`), "not-found", 404);
  });

  test("an abort during body collection prevents the commit", async () => {
    for (const storage of [solid(), lws()]) {
      const controller = new AbortController();
      const body = new ReadableStream<Uint8Array>({ pull() {} });
      const pending = storage.create(ROOT, body, {
        contentType: "text/plain",
        name: "aborted",
        signal: controller.signal,
      });
      controller.abort();
      await rejects(pending, "network");
      expect((await storage.list(ROOT)).items).toEqual([]);
      const existing = await storage.create(ROOT, "x", { contentType: "text/plain", name: "w" });
      const writer = new AbortController();
      const write = storage.write(existing.url, new ReadableStream<Uint8Array>({ pull() {} }), {
        contentType: "text/plain",
        ifMatch: existing.etag as string,
        signal: writer.signal,
      });
      writer.abort();
      await rejects(write, "network");
      expect(await (await storage.read(existing.url)).text()).toBe("x");
    }
  });

  test("named graphs never reach a triple-only format", async () => {
    const storage = solid();
    const graph = namedNode(`${EX}g`);
    const named = quad(namedNode(`${EX}s`), namedNode(`${EX}p`), literal("o"), graph);
    await expect(storage.writeRdf(`${ROOT}g.ttl`, [named], { ifMatch: "*" })).rejects.toThrow(
      /named graphs/,
    );
    await expect(storage.head(`${ROOT}g.ttl`)).rejects.toBeInstanceOf(StorageError);
    const written = await storage.writeRdf(`${ROOT}g.nq`, [named], {
      ifMatch: "*",
      contentType: "application/n-quads" as "text/turtle",
    });
    expect(written.created).toBe(true);
    const turtle = await storage.write(`${ROOT}t.ttl`, "", { contentType: TURTLE, ifMatch: "*" });
    await rejects(
      storage.patch(
        turtle.url,
        { kind: "rdf", inserts: [named], deletes: [] },
        { ifMatch: turtle.etag as string },
      ),
      "bad-request",
      422,
    );
    const nquads = await storage.patch(
      written.url,
      { kind: "rdf", inserts: [], deletes: [named] },
      { ifMatch: written.etag as string },
    );
    expect(nquads.created).toBe(false);
  });
});

describe("review round 2 regressions", () => {
  test("non-canonical or IRI-unsafe URLs are refused before anything is stored", async () => {
    for (const storage of [solid(), lws()]) {
      for (const url of [
        `${ROOT}a> <${EX}p> <${EX}o`,
        `${ROOT}a|b`,
        `${ROOT}a^b`,
        `${ROOT}./a`,
        "not a url",
      ]) {
        await rejects(
          storage.write(url, "x", { contentType: "text/plain", ifMatch: "*" }),
          "bad-request",
          400,
        );
      }
    }
  });

  test("serialisation escapes IRIs, relabels unsafe blank nodes and refuses bad tags/prefixes", async () => {
    const storage = solid();
    const evil = namedNode(`${EX}s> <${EX}forged> <${EX}o`);
    const written = await storage.writeRdf(
      `${ROOT}e.ttl`,
      [
        quad(evil, namedNode(`${EX}p`), literal("v")),
        quad(blankNode("a b> <x"), namedNode(`${EX}p`), literal("w", namedNode(`${EX}d>t`))),
        quad(blankNode("a b> <x"), namedNode(`${EX}q`), literal("hello", "en-GB")),
      ],
      { ifMatch: "*" },
    );
    const { dataset } = await storage.readRdf(written.url);
    expect(dataset.size).toBe(3);
    expect([...dataset].some((q) => q.predicate.value === `${EX}forged`)).toBe(false);
    // The relabelled blank node stays one node.
    expect(
      new Set(
        [...dataset].filter((q) => q.subject.termType === "BlankNode").map((q) => q.subject.value),
      ).size,
    ).toBe(1);
    await expect(
      storage.writeRdf(`${ROOT}l.ttl`, [quad(evil, namedNode(`${EX}p`), literal("v", "en x"))], {
        ifMatch: "*",
      }),
    ).rejects.toThrow(/language tag/);
    await expect(
      storage.writeRdf(`${ROOT}p.ttl`, [], { ifMatch: "*", prefixes: { "a b": EX } }),
    ).rejects.toThrow(/prefix name/);
    const prefixed = await storage.writeRdf(
      `${ROOT}q.ttl`,
      [quad(namedNode(`${EX}s`), namedNode(`${EX}p`), literal("v"))],
      { ifMatch: "*", prefixes: { ex: `${EX}>` } },
    );
    expect((await storage.readRdf(prefixed.url)).dataset.size).toBe(1);
    await expect(
      storage.writeRdf(
        `${ROOT}v.ttl`,
        [
          quad(
            namedNode(`${EX}s`),
            namedNode(`${EX}p`),
            variable("v") as unknown as Quad["object"],
          ),
        ],
        { ifMatch: "*" },
      ),
    ).rejects.toThrow(/cannot be serialised/);
  });

  test("prefixed-name lookalikes and base directions cannot forge triples", async () => {
    const storage = solid();
    const lookalike = namedNode("ex:o;ex:forged(ex:evil)");
    const written = await storage.writeRdf(
      `${ROOT}f.ttl`,
      [quad(namedNode("urn:s"), namedNode("urn:p"), lookalike)],
      { ifMatch: "*", prefixes: { ex: EX } },
    );
    const { dataset } = await storage.readRdf(written.url);
    expect([...dataset].map((q) => q.object.value)).toEqual(["ex:o;ex:forged(ex:evil)"]);
    await expect(
      storage.writeRdf(
        `${ROOT}d.ttl`,
        [
          quad(
            namedNode("urn:s"),
            namedNode("urn:p"),
            literal("v", "en--ltr . <urn:e> <urn:e> <urn:e>"),
          ),
        ],
        { ifMatch: "*" },
      ),
    ).rejects.toThrow(/base direction/);
    const rtl = await storage.writeRdf(
      `${ROOT}r.ttl`,
      [
        quad(
          namedNode("urn:s"),
          namedNode("urn:p"),
          literal("v", { language: "ar", direction: "rtl" }),
        ),
      ],
      { ifMatch: "*" },
    );
    expect((await storage.readRdf(rtl.url)).dataset.size).toBe(1);
  });

  test("non-UTF-8 percent-encodings move unchanged; Unicode and dotted prefixes are accepted", async () => {
    for (const storage of [solid(), lws({ moveResource: true })]) {
      const dst = await storage.create(ROOT, null, { kind: "container", name: "dst" });
      const source =
        storage.protocol === "solid"
          ? (await storage.write(`${ROOT}a%FF`, "x", { contentType: "text/plain", ifMatch: "*" }))
              .url
          : (await storage.create(ROOT, "x", { contentType: "text/plain", name: "a%FF" })).url;
      const moved = await storage.move(source, dst.url, await current(storage, source));
      expect(moved.url).toBe(`${dst.url}${source.slice(ROOT.length)}`);
    }
    const storage = solid();
    const written = await storage.writeRdf(
      `${ROOT}u.ttl`,
      [quad(namedNode(`${EX}s`), namedNode(`${EX}p`), literal("v"))],
      { ifMatch: "*", prefixes: { "schema.org": EX, "\u00E9": "urn:x:" } },
    );
    expect((await storage.readRdf(written.url)).dataset.size).toBe(1);
    await expect(
      storage.writeRdf(`${ROOT}t.ttl`, [], { ifMatch: "*", prefixes: { "ex.": EX } }),
    ).rejects.toThrow(/prefix name/);
    // Characters outside Turtle's PN_PREFIX ranges are refused before anything is written.
    for (const name of ["\u00B5", "a\u00B2", "_a", "-a", "1a"]) {
      await expect(
        storage.writeRdf(`${ROOT}w.ttl`, [], { ifMatch: "*", prefixes: { [name]: EX } }),
      ).rejects.toThrow(/prefix name/);
    }
    const astral = await storage.writeRdf(
      `${ROOT}w.ttl`,
      [quad(namedNode(`${EX}s`), namedNode(`${EX}p`), literal("v"))],
      { ifMatch: "*", prefixes: { "\u{10000}a\u0301": EX } },
    );
    expect((await storage.readRdf(astral.url)).dataset.size).toBe(1);
  });

  test("a namespace with unescaped regex metacharacters (IPv6) is dropped, not corrupting", async () => {
    const storage = solid();
    const { url } = await storage.writeRdf(
      `${ROOT}ip.ttl`,
      [quad(namedNode("urn:s"), namedNode("urn:p"), namedNode("http://localhost"))],
      { ifMatch: "*", prefixes: { ip: "http://[::1]/" } },
    );
    const { dataset } = await storage.readRdf(url);
    expect([...dataset].map((q) => q.object.value)).toEqual(["http://localhost"]);
  });

  test("a dotted prefix cannot act as a regex wildcard in the writer", async () => {
    const storage = solid();
    // `a-b:` is a valid scheme, and matches the unescaped pattern `a.b:` n3 would build.
    const forged = namedNode("a-b:o;b:forged");
    const written = await storage.writeRdf(
      `${ROOT}dot.ttl`,
      [quad(namedNode("urn:s"), forged, literal("v"))],
      { ifMatch: "*", prefixes: { "a.b": "urn:unused:", b: "urn:b:" } },
    );
    const { dataset } = await storage.readRdf(written.url);
    expect([...dataset].map((q) => q.predicate.value)).toEqual(["a-b:o;b:forged"]);
    expect(await (await storage.read(written.url)).text()).not.toContain("@prefix a.b");
  });

  test("moving a resource rewrites only its own anchors, not lookalike siblings", async () => {
    for (const storage of [solid(), lws({ moveResource: true })]) {
      const dst = await storage.create(ROOT, null, { kind: "container", name: "dst" });
      const source =
        storage.protocol === "solid"
          ? (await storage.write(`${ROOT}a`, "x", { contentType: "text/plain", ifMatch: "*" })).url
          : (await storage.create(ROOT, "x", { contentType: "text/plain", name: "a" })).url;
      await storage.setMetadata(
        source,
        [
          { op: "add", anchor: `${ROOT}another`, rel: `${EX}rel`, href: `${EX}x` },
          { op: "add", anchor: `${source}#frag`, rel: `${EX}rel`, href: `${EX}y` },
        ],
        await currentMeta(storage, source),
      );
      const moved = await storage.move(source, dst.url, await current(storage, source));
      const { links } = await storage.metadata(moved.url);
      expect(links.get(`${ROOT}another`)?.get(`${EX}rel`)).toHaveLength(1);
      expect(links.get(`${dst.url}another`)).toBeUndefined();
      expect(links.get(`${moved.url}#frag`)?.get(`${EX}rel`)).toHaveLength(1);
    }
    // A container move still carries anchors on its descendants along.
    const storage = solid();
    const box = await storage.create(ROOT, null, { kind: "container", name: "box" });
    const into = await storage.create(ROOT, null, { kind: "container", name: "into" });
    await storage.setMetadata(
      box.url,
      [{ op: "add", anchor: `${box.url}child`, rel: `${EX}rel`, href: `${EX}x` }],
      await currentMeta(storage, box.url),
    );
    const movedBox = await storage.move(box.url, into.url, await current(storage, box.url));
    const { links } = await storage.metadata(movedBox.url);
    expect(links.get(`${movedBox.url}child`)?.get(`${EX}rel`)).toHaveLength(1);
  });

  test("a queued mutation rejects promptly when its signal aborts", async () => {
    for (const storage of [solid(), lws()]) {
      const stuck = storage.create(ROOT, new ReadableStream<Uint8Array>({ pull() {} }), {
        contentType: "text/plain",
        signal: new AbortController().signal,
      });
      const controller = new AbortController();
      const queued = storage.create(ROOT, "x", {
        contentType: "text/plain",
        name: "queued",
        signal: controller.signal,
      });
      controller.abort();
      await rejects(queued, "network");
      const already = new AbortController();
      already.abort();
      await rejects(
        storage.create(ROOT, "y", { contentType: "text/plain", signal: already.signal }),
        "network",
      );
      void stuck.catch(() => undefined);
    }
  });
});
