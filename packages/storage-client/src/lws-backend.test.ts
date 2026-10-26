// AUTHORED-BY Codex GPT-6.1-Sol
import { deriveFeatures } from "@jeswr/storage-capabilities";
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
import type { RecordedExchanges } from "./fixtures/css.js";
import { LWS_CONTAINER as CONTAINER, lwsReadExchanges, LWS_ROOT as ROOT } from "./fixtures/lws.js";
import { createLwsBackend } from "./lws.js";
import type { AuthFetch, Entry } from "./types.js";

const LWS = "https://www.w3.org/ns/lws#";
const NOTE = `${CONTAINER}note-0000.ttl`;
const FOREIGN = "https://evil.example/";
const pageBody = (items: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  type: "Container",
  items,
  ...extra,
});
const storageLink = (target = ROOT) => `<${target}>; rel="${LWS}storage"`;

function backend(exchanges: RecordedExchanges = lwsReadExchanges) {
  const calls: { url: string; method: string; headers: Headers; init?: RequestInit }[] = [];
  const fetch = vi.fn<AuthFetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ url, method, headers, init });
    const recorded = exchanges[`${method} ${url}`];
    if (!recorded) return new Response(null, { status: 404 });
    if (headers.get("if-none-match") === recorded.headers.etag)
      return new Response(null, {
        status: 304,
        headers: { etag: recorded.headers.etag, link: recorded.headers.link ?? "" },
      });
    const range = /^bytes=(\d+)-(\d*)$/.exec(headers.get("range") ?? "");
    if (range) {
      const bytes = new TextEncoder().encode(recorded.body);
      return new Response(
        bytes.slice(Number(range[1]), range[2] ? Number(range[2]) + 1 : undefined),
        { status: 206, headers: recorded.headers },
      );
    }
    return new Response(method === "HEAD" ? null : recorded.body, {
      status: recorded.status,
      headers: recorded.headers,
    });
  });
  return { storage: createLwsBackend({ root: ROOT, fetch }), fetch, calls };
}

function listing(raw: unknown = pageBody(), headers: Record<string, string> = {}) {
  return backend({
    [`GET ${CONTAINER}`]: {
      status: 200,
      headers: { "content-type": "application/lws+json", ...headers },
      body: JSON.stringify(raw),
    },
  });
}

function metadata(raw: unknown, contentType = "application/linkset+json", url = `${NOTE}.meta`) {
  return backend({
    [`HEAD ${NOTE}`]: { status: 200, headers: { link: `<${url}>; rel="linkset"` } },
    [`GET ${url}`]: {
      status: 200,
      headers: { "content-type": contentType },
      body: JSON.stringify(raw),
    },
  });
}

async function rejects(promise: Promise<unknown>, code = "invalid-response") {
  const error = await promise.catch((error: unknown) => error);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code });
  return error as StorageError;
}
async function collect(entries: AsyncIterable<Entry>) {
  const all: Entry[] = [];
  for await (const entry of entries) all.push(entry);
  return all;
}

describe("sparq fixtures and pagination", () => {
  test("listAll consumes 1500 members in exactly three 500-member pages", async () => {
    const { storage, calls } = backend();
    const all = await collect(storage.listAll(CONTAINER));
    expect(all).toHaveLength(1500);
    expect(new Set(all.map(({ url }) => url)).size).toBe(1500);
    expect(all[0]).toEqual({
      url: NOTE,
      kind: "resource",
      contentType: "text/turtle",
      size: 17,
      modified: new Date("2026-10-02T10:30:00Z"),
      types: [],
    });
    expect(all.at(-1)?.url).toBe(`${CONTAINER}note-1499.ttl`);
    expect(calls.map(({ url }) => url)).toEqual([
      CONTAINER,
      `${CONTAINER}?page=2`,
      `${CONTAINER}?page=3`,
    ]);
    for (const call of calls) {
      expect(call.headers.get("accept")).toBe("application/lws+json, application/ld+json;q=0.5");
      expect(call.init?.redirect).toBe("manual");
    }
    const page = await storage.list(CONTAINER);
    expect(page).toMatchObject({
      total: 1500,
      next: { url: `${CONTAINER}?page=2` },
      etag: '"abcdefghijklmnopqrstuvwx"',
    });
    const raw = await storage.read(`${CONTAINER}?page=2`);
    expect(raw.kind).toBe("container");
    expect(raw.links.get("next")?.[0]?.target).toBe(`${CONTAINER}?page=3`);
    expect(JSON.parse(await raw.text()).items).toHaveLength(500);
  });

  test("cursor URLs are canonicalised while preserving opaque query spelling", async () => {
    const cursor = `${ROOT.toUpperCase()}other?token=a%2fb&x=1&x=2`;
    const canonical = new URL(cursor).href;
    const { storage, calls } = backend({
      [`GET ${canonical}`]: {
        status: 200,
        headers: { "content-type": 'application/ld+json; profile="https://www.w3.org/ns/lws/v1"' },
        body: JSON.stringify(pageBody([{ id: "child" }], { type: "ContainerPage" })),
      },
    });
    const page = await storage.list(CONTAINER, { cursor: { url: cursor } });
    expect(calls[0]?.url).toBe(canonical);
    expect(page.items[0]?.url).toBe(`${ROOT}child`);
    for (const url of [FOREIGN, "../outside", `${ROOT}..%2fprivate`, "file:///tmp/x"])
      await rejects(storage.list(CONTAINER, { cursor: { url } }), "scope");
    await rejects(storage.list(CONTAINER, { cursor: {} as { url: string } }), "scope");
    expect(calls).toHaveLength(1);
  });

  test("listAll detects a multi-page loop", async () => {
    const exchanges = Object.fromEntries(
      [CONTAINER, `${CONTAINER}?page=2`, `${CONTAINER}?page=3`].map((url, i) => [
        `GET ${url}`,
        {
          status: 200,
          headers: {
            "content-type": "application/lws+json",
            link: `<${CONTAINER}?page=${i === 0 ? 2 : i === 1 ? 3 : 2}>; rel="next"`,
          },
          body: JSON.stringify(pageBody()),
        },
      ]),
    );
    const { storage, calls } = backend(exchanges);
    await rejects(collect(storage.listAll(CONTAINER)));
    expect(calls).toHaveLength(3);
  });

  test("sparq headers with 60 extra types before paging links retain every page", async () => {
    const types = Array.from({ length: 60 }, (_, i) => `<urn:extra:${i}>; rel=type`);
    const next = `${CONTAINER}?token=a%2fb&x=1&x=2`;
    const links = [
      storageLink(),
      `<${ROOT}>; rel=up`,
      `<${CONTAINER}.meta>; rel=linkset`,
      `<${LWS}Container>; rel=type`,
      ...types,
      `<${CONTAINER}>; rel=first`,
      `<${next}>; rel=next`,
      `<${next}>; rel=last`,
    ];
    expect(links).toHaveLength(67);
    const { storage, calls } = backend({
      [`GET ${CONTAINER}`]: {
        status: 200,
        headers: { "content-type": "application/lws+json", link: links.join(", ") },
        body: JSON.stringify(pageBody([{ id: "a" }], { totalItems: 2 })),
      },
      [`GET ${next}`]: {
        status: 200,
        headers: { "content-type": "application/lws+json" },
        body: JSON.stringify(pageBody([{ id: "b" }], { totalItems: 2 })),
      },
    });
    expect((await collect(storage.listAll(CONTAINER))).map(({ url }) => url)).toEqual([
      `${CONTAINER}a`,
      `${CONTAINER}b`,
    ]);
    expect(calls.map(({ url }) => url)).toEqual([CONTAINER, next]);
  });

  test("cursor fetch uses the canonical scoped destination under Fetch's Request parser", async () => {
    const cursor = "HTTPS://LWS.EXAMPLE:443/a/../notes/?token=a%2fb&x=1&x=2";
    const canonical = new URL(cursor).href;
    const requests: Request[] = [];
    const fetch = vi.fn<AuthFetch>(async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", "Bearer probe");
      requests.push(new Request(input, { ...init, headers }));
      return new Response(JSON.stringify(pageBody([{ id: "child" }])), {
        headers: { "content-type": "application/lws+json" },
      });
    });
    const storage = createLwsBackend({ root: ROOT, fetch });
    const page = await storage.list(CONTAINER, { cursor: { url: cursor } });
    expect(fetch.mock.calls[0]?.[0]).toBe(canonical);
    expect(requests.map(({ url }) => url)).toEqual([canonical]);
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer probe");
    expect(page.items[0]?.url).toBe(`${ROOT}notes/child`);
  });

  test("relative next links resolve in response context; anchored next links are ignored", async () => {
    const { storage } = listing(pageBody(), {
      link: '<?page=2>; rel="next", <https://evil.example/>; rel="next"; anchor="other"',
    });
    expect((await storage.list(CONTAINER)).next).toEqual({ url: `${CONTAINER}?page=2` });
    expect((await listing().storage.list(CONTAINER)).next).toBeNull();
  });

  test("a slashless root next link is compared and returned in canonical form", async () => {
    const root = `${ROOT}storage/`;
    const alias = root.slice(0, -1);
    const fetch = vi.fn<AuthFetch>(
      async () =>
        new Response(JSON.stringify(pageBody()), {
          headers: { "content-type": "application/lws+json", link: `<${alias}>; rel=next` },
        }),
    );
    const storage = createLwsBackend({ root, fetch });
    for (const container of [root, alias]) {
      await rejects(storage.list(container));
      await rejects(collect(storage.listAll(container)));
    }
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.every(([url]) => url === root)).toBe(true);

    const cursor = `${alias}?token=a%2fb&x=1&x=2`;
    const page = await storage.list(root, { cursor: { url: cursor } });
    expect(page.next).toEqual({ url: root });
    expect(fetch.mock.calls.at(-1)?.[0]).toBe(`${root}?token=a%2fb&x=1&x=2`);
  });
});

describe("listing validation and advisory fields", () => {
  test.each([0, 1])("bounds raw items per page at 10000 (excess %i)", async (excess) => {
    const items = Array.from({ length: 10000 }, (_, i) => ({ id: String(i) }));
    // A duplicate still counts toward the raw item budget.
    if (excess) items.push({ id: "0" });
    const result = listing(pageBody(items)).storage.list(CONTAINER);
    if (excess) await rejects(result);
    else {
      const page = await result;
      expect(page.items).toHaveLength(10000);
      expect(page.items[0]?.url).toBe(`${CONTAINER}0`);
      expect(page.items.at(-1)?.url).toBe(`${CONTAINER}9999`);
    }
  });

  test.each([0, 1])("bounds cumulative resolved item id lengths (excess %i)", async (excess) => {
    const cap = 4 * 1024 * 1024;
    const cursor = `${CONTAINER}?token=${"x".repeat(8000)}`;
    const items = Array.from({ length: 500 }, (_, i) => ({ id: `#${i}` }));
    const used = items.reduce((sum, { id }) => sum + new URL(id, cursor).href.length, 0);
    const finalId = `${ROOT}${"y".repeat(cap - used - ROOT.length + excess)}`;
    items.push({ id: finalId });
    const raw = pageBody(items);
    expect(JSON.stringify(raw).length).toBeLessThan(200000);
    const { storage } = backend({
      [`GET ${cursor}`]: {
        status: 200,
        headers: { "content-type": "application/lws+json" },
        body: JSON.stringify(raw),
      },
    });
    const result = storage.list(CONTAINER, { cursor: { url: cursor } });
    if (excess) await rejects(result);
    else {
      const page = await result;
      expect(page.items).toHaveLength(items.length);
      expect(page.items[0]?.url).toBe(`${cursor}#0`);
      expect(page.items.at(-1)?.url).toBe(finalId);
      expect(page.items.reduce((sum, { url }) => sum + url.length, 0)).toBe(cap);
    }
  });

  test.each([
    "unique",
    "duplicate",
    "foreign",
  ])("rejects 10000 %s references expanded against a long cursor", async (kind) => {
    const cursor = `${CONTAINER}?token=${"x".repeat(8000)}`;
    const raw = pageBody(
      Array.from({ length: 10000 }, (_, i) => ({
        id:
          kind === "foreign"
            ? `${FOREIGN}${"x".repeat(500)}#${i}`
            : `#${kind === "unique" ? i : "same"}`,
      })),
    );
    // Each case stays below the independent 16 MiB wire cap.
    expect(JSON.stringify(raw).length).toBeLessThan(16 * 1024 * 1024);
    const { storage, calls } = backend({
      [`GET ${cursor}`]: {
        status: 200,
        headers: { "content-type": "application/lws+json" },
        body: JSON.stringify(raw),
      },
    });
    const error = await rejects(storage.list(CONTAINER, { cursor: { url: cursor } }));
    expect(error.message).toContain("Resolved listing IDs exceed 4 MiB");
    expect(calls).toHaveLength(1);
  });

  test("relative and non-path-aligned members, deduplication and field mapping preserve server order", async () => {
    const { storage } = listing(
      pageBody([
        {
          id: "z",
          type: [
            "DataResource",
            `${LWS}DataResource`,
            "urn:Note",
            "https://schema.example/Note",
            "compact",
            "bad IRI: a",
            "https://[",
            3,
          ],
          format: "text/turtle",
          size: 0,
          modified: "2026-10-02T10:30:00Z",
        },
        { id: "../elsewhere", type: `${LWS}Container`, format: "text/plain", size: 2 },
        { id: "a/", type: "DataResource", format: "image/png" },
        { id: "z", format: "text/plain", size: 55 },
        { id: `${FOREIGN}x` },
        { id: "file:///tmp/x" },
        { id: "http://[" },
        { id: `${ROOT}..%2fsecret` },
        { id: `https://user:secret@lws.example/x` },
      ]),
    );
    expect((await storage.list(CONTAINER)).items).toEqual([
      {
        url: `${CONTAINER}z`,
        kind: "resource",
        contentType: "text/turtle",
        size: 0,
        modified: new Date("2026-10-02T10:30:00Z"),
        types: ["urn:Note", "https://schema.example/Note"],
      },
      {
        url: `${ROOT}elsewhere`,
        kind: "container",
        contentType: null,
        size: 2,
        modified: null,
        types: [],
      },
      {
        url: `${CONTAINER}a/`,
        kind: "resource",
        contentType: "image/png",
        size: null,
        modified: null,
        types: [],
      },
    ]);
  });

  test("compact and IRI container types accepted; compact terms and malformed optional fields dropped", async () => {
    for (const type of [
      "Container",
      "ContainerPage",
      `${LWS}Container`,
      `${LWS}ContainerPage`,
      ["Other", "Container"],
      [1, "ContainerPage"],
    ]) {
      expect((await listing(pageBody([], { type })).storage.list(CONTAINER)).items).toEqual([]);
    }
    const fields = [
      { type: "Container", format: "text/plain", size: -1, modified: "bad" },
      { type: ["Container", `${LWS}Container`, "Other"], format: 1, size: 0.5, modified: 4 },
      { type: {}, format: "text/plain; charset=utf8", size: Number.MAX_SAFE_INTEGER + 1 },
      { format: "bad", size: "1" },
      { format: "TEXT/PLAIN", size: Number.MAX_SAFE_INTEGER },
    ];
    const items = (
      await listing(pageBody(fields.map((field, i) => ({ id: String(i), ...field })))).storage.list(
        CONTAINER,
      )
    ).items;
    expect(
      items.map(({ contentType, size, modified, types }) => ({
        contentType,
        size,
        modified,
        types,
      })),
    ).toEqual([
      { contentType: null, size: null, modified: null, types: [] },
      { contentType: null, size: null, modified: null, types: [] },
      { contentType: null, size: null, modified: null, types: [] },
      { contentType: null, size: null, modified: null, types: [] },
      { contentType: "TEXT/PLAIN", size: Number.MAX_SAFE_INTEGER, modified: null, types: [] },
    ]);
  });

  test("totalItems is a non-negative safe integer or null", async () => {
    for (const value of [undefined, null, -1, 0.5, "5", {}, Number.MAX_SAFE_INTEGER + 1])
      expect(
        (await listing(pageBody([], { totalItems: value })).storage.list(CONTAINER)).total,
      ).toBeNull();
    for (const value of [0, 1, Number.MAX_SAFE_INTEGER])
      expect(
        (await listing(pageBody([], { totalItems: value })).storage.list(CONTAINER)).total,
      ).toBe(value);
  });

  test("malformed listing structures fail closed", async () => {
    for (const raw of [
      null,
      [],
      5,
      { type: "Container" },
      { type: "Container", items: {} },
      { items: [] },
      pageBody([], { type: "DataResource" }),
      pageBody([], { type: [] }),
      pageBody([null]),
      pageBody([[]]),
      pageBody([1]),
      pageBody([{}]),
      pageBody([{ id: 2 }]),
    ])
      await rejects(listing(raw).storage.list(CONTAINER));
  });

  test("wrong or missing media types, invalid JSON and an absent body are invalid-response", async () => {
    for (const headers of [
      { "content-type": "application/json" },
      { "content-type": "text/html" },
      {},
    ]) {
      const { storage } = backend({
        [`GET ${CONTAINER}`]: { status: 200, headers, body: JSON.stringify(pageBody()) },
      });
      await rejects(storage.list(CONTAINER));
    }
    const missing = createLwsBackend({ root: ROOT, fetch: async () => new Response(null) });
    await rejects(missing.list(CONTAINER));
    for (const body of ["{", "", undefined]) {
      const { storage } = backend({
        [`GET ${CONTAINER}`]: {
          status: 200,
          headers: { "content-type": "application/lws+json" },
          body,
        },
      });
      await rejects(storage.list(CONTAINER));
    }
  });

  test("foreign, unsafe and self next links are invalid-response before a follow-up fetch", async () => {
    for (const next of [FOREIGN, CONTAINER, `${ROOT}..%2fsecret`, "file:///tmp/x"]) {
      const { storage, calls } = listing(pageBody(), { link: `<${next}>; rel="next"` });
      await rejects(storage.list(CONTAINER));
      expect(calls).toHaveLength(1);
    }
    const url = `${CONTAINER}?page=2`;
    await rejects(
      backend({
        [`GET ${url}`]: {
          status: 200,
          headers: { "content-type": "application/lws+json", link: `<>; rel="next"` },
          body: JSON.stringify(pageBody()),
        },
      }).storage.list(CONTAINER, { cursor: { url } }),
    );
  });

  test("opaque cursor spelling cannot hide storage links or self links", async () => {
    const url = `${ROOT.toUpperCase()}notes/?opaque=a%2fb`;
    for (const link of [storageLink(FOREIGN), '<>; rel="next"']) {
      const { storage } = backend({
        [`GET ${new URL(url).href}`]: {
          status: 200,
          headers: { "content-type": "application/lws+json", link },
          body: JSON.stringify(pageBody()),
        },
      });
      await rejects(
        storage.list(CONTAINER, { cursor: { url } }),
        link === storageLink(FOREIGN) ? "scope" : "invalid-response",
      );
    }
  });

  test("container syntax is checked before sending, including empty delimiters", async () => {
    const { storage, fetch } = backend();
    for (const url of [
      `${ROOT}file`,
      `${CONTAINER}?`,
      `${CONTAINER}#`,
      `${CONTAINER}?page=1`,
      `${CONTAINER}#top`,
    ])
      await rejects(storage.list(url), "bad-request");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("HEAD, byte and RDF reads", () => {
  test("sparq up/linkset/type links, validators and live/buffered body semantics", async () => {
    const { storage, calls } = backend();
    const result = await storage.head(NOTE);
    expect(result).toMatchObject({
      url: NOTE,
      status: 200,
      body: null,
      etag: '"note"',
      lastModified: new Date("2026-10-02T10:30:00Z"),
      contentType: "text/turtle",
      kind: "resource",
      parent: CONTAINER,
      metadataUrl: `${NOTE}.meta`,
      allow: null,
    });
    expect(await result.text()).toBe("");
    expect(calls[0]?.method).toBe("HEAD");
    expect(calls[0]?.headers.get("accept")).toBe("*/*");
    const body = await storage.read(NOTE);
    expect(await body.text()).toBe('<> <urn:p> "hi" .\n');
    const bytes = await body.bytes();
    bytes[0] = 0;
    expect((await body.bytes())[0]).toBe(60);
    expect((await body.blob()).type).toBe("text/turtle");
    expect(await new Response((await storage.read(NOTE)).body).text()).toBe(await body.text());
    expect(calls.at(-1)?.headers.get("accept")).toBe("*/*");
  });

  test("LWS kind uses only type links, root always container, parent is first in-scope up", async () => {
    const { storage } = backend({
      [`GET ${ROOT}`]: { status: 200, headers: { link: `<${ROOT}wrong>; rel="up"` } },
      [`GET ${CONTAINER}`]: {
        status: 200,
        headers: { link: `<${ROOT}sideways>; rel="up", <${ROOT}>; rel="up"` },
      },
      [`GET ${NOTE}`]: {
        status: 200,
        headers: {
          link: `<${LWS}Container>; rel="type", <../parent>; rel="up", <./relative.meta>; rel="linkset", <${LWS}DataResource>; rel="type"`,
        },
      },
    });
    expect(await storage.read(ROOT)).toMatchObject({ kind: "container", parent: null });
    expect(await storage.read(CONTAINER)).toMatchObject({
      kind: "resource",
      parent: `${ROOT}sideways`,
    });
    expect(await storage.read(NOTE)).toMatchObject({
      kind: "container",
      parent: `${ROOT}parent`,
      metadataUrl: `${CONTAINER}relative.meta`,
    });
  });

  test("unsafe or absent up/linkset and anchored types fail closed, WAC-Allow ignored", async () => {
    for (const target of [
      FOREIGN,
      "file:///tmp/x",
      `${ROOT}..%2fx`,
      "https://user:secret@lws.example/x",
    ]) {
      const { storage } = backend({
        [`GET ${NOTE}`]: {
          status: 200,
          headers: {
            link: `<${target}>; rel="up", <${ROOT}>; rel="up", <${target}>; rel="linkset", <${NOTE}.meta>; rel="linkset", <${LWS}Container>; rel="type"; anchor="other"`,
            "wac-allow": 'user="read write"',
          },
        },
      });
      expect(await storage.read(NOTE)).toMatchObject({
        kind: "resource",
        parent: null,
        metadataUrl: null,
        allow: null,
      });
    }
    const { storage } = backend({ [`HEAD ${NOTE}`]: { status: 200, headers: {} } });
    expect(await storage.head(NOTE)).toMatchObject({
      parent: null,
      metadataUrl: null,
      kind: "resource",
    });
  });

  test("conditional, range, custom accept and unsolicited statuses match Solid", async () => {
    const { storage, calls } = backend();
    const cached = await storage.read(NOTE, { ifNoneMatch: '"note"', accept: "text/*" });
    expect(cached).toMatchObject({ status: 304, body: null });
    expect(await cached.text()).toBe("");
    expect(calls.at(-1)?.headers.get("accept")).toBe("text/*");
    expect(await (await storage.read(NOTE, { range: { start: 3, end: 6 } })).text()).toBe("<urn");
    expect(calls.at(-1)?.headers.get("range")).toBe("bytes=3-6");
    expect((await storage.read(NOTE, { range: { start: 5 } })).status).toBe(206);
    expect(calls.at(-1)?.headers.get("range")).toBe("bytes=5-");
    for (const range of [
      { start: -1 },
      { start: 0.5 },
      { start: 1, end: 0 },
      { start: 0, end: 1.5 },
      { start: 0, end: Infinity },
    ])
      await expect(storage.read(NOTE, { range })).rejects.toThrow(RangeError);
    for (const status of [201, 204, 206, 301, 302, 304, 307]) {
      const { storage } = backend({
        [`GET ${CONTAINER}`]: { status, headers: { location: FOREIGN } },
        [`HEAD ${NOTE}`]: { status, headers: {} },
      });
      await rejects(storage.read(CONTAINER));
      await rejects(storage.list(CONTAINER));
      await rejects(storage.head(NOTE));
    }
    const failure = backend({
      [`GET ${NOTE}`]: {
        status: 403,
        headers: { "content-type": "application/problem+json" },
        body: '{"title":"Forbidden"}',
      },
    });
    expect((await rejects(failure.storage.read(NOTE), "forbidden")).problem).toEqual({
      title: "Forbidden",
    });
  });

  test("readRdf parses relative Turtle and handles 304, non-RDF and malformed RDF", async () => {
    const { storage, calls } = backend();
    const rdf = await storage.readRdf(NOTE);
    expect(rdf).toMatchObject({ url: NOTE, etag: '"note"', contentType: "text/turtle" });
    expect(rdf.dataset.size).toBe(1);
    expect([...rdf.dataset][0]?.subject.value).toBe(NOTE);
    expect(calls[0]?.headers.get("accept")).toBe("text/turtle, application/ld+json;q=0.9");
    const unchanged = await storage.readRdf(NOTE, { ifNoneMatch: '"note"' });
    expect(unchanged).toMatchObject({ notModified: true, contentType: "", etag: '"note"' });
    expect(unchanged.dataset.size).toBe(0);
    for (const type of ["text/plain", "text/turtle"]) {
      await rejects(
        backend({
          [`GET ${NOTE}`]: { status: 200, headers: { "content-type": type }, body: "<" },
        }).storage.readRdf(NOTE),
        "not-rdf",
      );
    }
  });
});

describe("scope and foreign storage responses", () => {
  test("all request paths reject foreign/unsafe URLs before fetch", async () => {
    const { storage, fetch } = backend();
    for (const url of [
      FOREIGN,
      "relative",
      "file:///tmp/x",
      `${ROOT}..%2fsecret`,
      "https://user:secret@lws.example/x",
      "https://lws.example.evil/x",
    ]) {
      for (const call of [
        storage.head,
        storage.read,
        storage.readRdf,
        storage.list,
        storage.metadata,
        storage.parentOf,
      ])
        await rejects(call(url), "scope");
      expect(storage.isWithinStorage(url)).toBe(false);
    }
    expect(storage.isWithinStorage(NOTE)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("nested roots enforce path boundaries even on the same origin", async () => {
    const root = `${ROOT}alice/`;
    const fetch = vi.fn<AuthFetch>(async () => new Response(null));
    const storage = createLwsBackend({ root, fetch });
    for (const url of [
      `${ROOT}bob/x`,
      `${ROOT}alice-other/x`,
      `${ROOT}alice/../bob/x`,
      `${root}..%2fbob/x`,
    ]) {
      expect(storage.isWithinStorage(url)).toBe(false);
      await rejects(storage.read(url), "scope");
    }
    expect(storage.isWithinStorage(`${root}note`)).toBe(true);
    expect(await storage.parentOf(root.slice(0, -1))).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("any foreign storage link causes scope and body discard on every response path", async () => {
    for (const link of [
      storageLink(FOREIGN),
      `${storageLink()}, ${storageLink(FOREIGN)}`,
      `${storageLink(FOREIGN)}, ${storageLink()}`,
    ]) {
      for (const operation of ["head", "read", "readRdf", "list", "metadata"] as const) {
        let cancelled = false;
        const fetch = vi.fn<AuthFetch>(async (_input, init) => {
          if (operation === "metadata" && init?.method === "HEAD")
            return new Response(null, { headers: { link: `<${NOTE}.meta>; rel="linkset"` } });
          return new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { link } },
          );
        });
        const storage = createLwsBackend({ root: ROOT, fetch });
        await rejects(storage[operation](operation === "list" ? CONTAINER : NOTE), "scope");
        expect(cancelled).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(operation === "metadata" ? 2 : 1);
      }
    }
    const { storage } = backend({
      [`HEAD ${NOTE}`]: { status: 200, headers: { link: storageLink(FOREIGN) } },
    });
    await rejects(storage.metadata(NOTE), "scope");
  });

  test("foreign storage links past the old member/byte bounds are still checked", async () => {
    for (const link of [
      `${Array.from({ length: 64 }, (_, i) => `<urn:type:${i}>; rel=type`).join(",")}, ${storageLink(FOREIGN)}`,
      `<urn:type>; rel=type; title="${"x".repeat(8192)}", ${storageLink(FOREIGN)}`,
    ]) {
      let cancelled = false;
      const storage = createLwsBackend({
        root: ROOT,
        fetch: async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { link } },
          ),
      });
      await rejects(storage.read(NOTE), "scope");
      expect(cancelled).toBe(true);
    }
  });

  test("matching and absent storage links accepted; other-context links ignored; explicit id checked", async () => {
    for (const link of [
      storageLink(),
      `${storageLink()}, ${storageLink()}`,
      `${storageLink()}, <${FOREIGN}>; rel="${LWS}storage"; anchor="other"`,
      "",
    ]) {
      const { storage } = listing(pageBody(), { link });
      expect((await storage.list(CONTAINER)).items).toEqual([]);
    }
    const id = "https://lws.example/storage/alice";
    const fetch = vi.fn<AuthFetch>(
      async () => new Response(null, { headers: { link: storageLink(id) } }),
    );
    const storage = createLwsBackend({ root: ROOT, storage: id, fetch });
    expect((await storage.head(NOTE)).status).toBe(200);
    expect(storage.isWithinStorage(FOREIGN)).toBe(false);
    await rejects(storage.read(FOREIGN), "scope");
    expect(fetch).toHaveBeenCalledTimes(1);
    // An advertised mismatch wins even over an error status or a conditional 304.
    for (const status of [403, 304]) {
      const storage = createLwsBackend({
        root: ROOT,
        fetch: async () => new Response(null, { status, headers: { link: storageLink(FOREIGN) } }),
      });
      await rejects(storage.read(NOTE, { ifNoneMatch: '"note"' }), "scope");
    }
  });
});

describe("RFC 9264 metadata", () => {
  test.each([
    0, 1,
  ])("bounds targets across all contexts and relations (excess %i)", async (excess) => {
    const targets = (length: number) => Array.from({ length }, () => ({ href: "#x" }));
    const raw = {
      linkset: [
        { anchor: NOTE, related: targets(4000), license: targets(2000) },
        { anchor: NOTE, related: targets(2000) },
        { anchor: FOREIGN, related: targets(2000 + excess) },
      ],
    };
    const result = metadata(raw).storage.metadata(NOTE);
    if (excess) await rejects(result);
    else {
      const { links } = await result;
      expect(links.get(NOTE)?.get("related")).toHaveLength(6000);
      expect(links.get(NOTE)?.get("license")).toHaveLength(2000);
      expect(links.get(FOREIGN)?.get("related")).toHaveLength(2000);
    }
  });

  test.each([
    0, 1,
  ])("bounds cumulative resolved anchor and href lengths (excess %i)", async (excess) => {
    const cap = 4 * 1024 * 1024;
    const url = `${NOTE}.meta?q=${"x".repeat(60000)}`;
    const expanded = new URL("#x", url).href;
    const length = Math.floor((cap - NOTE.length) / expanded.length);
    const remaining = cap - NOTE.length - length * expanded.length;
    const finalHref = `urn:${"x".repeat(remaining - 4 + excess)}`;
    const raw = {
      linkset: [
        {
          anchor: NOTE,
          related: [...Array.from({ length }, () => ({ href: "#x" })), { href: finalHref }],
        },
      ],
    };
    // The wire body is small; relative references amplify only during URL resolution.
    expect(JSON.stringify(raw).length).toBeLessThan(100000);
    const result = metadata(raw, "application/linkset+json", url).storage.metadata(NOTE);
    if (excess) await rejects(result);
    else {
      const { links } = await result;
      const related = links.get(NOTE)?.get("related");
      expect(related).toHaveLength(length + 1);
      expect(related?.[0]?.href).toBe(expanded);
      expect(related?.at(-1)?.href).toBe(finalHref);
    }
  });

  test("rejects thousands of fragments expanded against a long query", async () => {
    const url = `${NOTE}.meta?q=${"x".repeat(60000)}`;
    const raw = {
      linkset: [
        {
          anchor: NOTE,
          related: Array.from({ length: 5000 }, (_, i) => ({ href: `#${i}` })),
        },
      ],
    };
    expect(JSON.stringify(raw).length).toBeLessThan(100000);
    await rejects(metadata(raw, "application/linkset+json", url).storage.metadata(NOTE));
    expect(
      (await metadata({ linkset: [] }, "application/linkset+json", url).storage.metadata(NOTE))
        .links.size,
    ).toBe(0);
  });

  test("bounds resolved anchors even without any targets", async () => {
    const url = `${NOTE}.meta?q=${"x".repeat(60000)}`;
    const length = Math.floor((4 * 1024 * 1024) / url.length);
    const contexts = Array.from({ length }, () => ({ anchor: "" }));
    const { links } = await metadata(
      { linkset: contexts },
      "application/linkset+json",
      url,
    ).storage.metadata(NOTE);
    expect(links.size).toBe(1);
    expect(links.get(url)?.size).toBe(0);
    contexts.push({ anchor: "" });
    await rejects(
      metadata({ linkset: contexts }, "application/linkset+json", url).storage.metadata(NOTE),
    );
  });

  test("reads actual sparq linkset with server-managed up/type/self", async () => {
    const { storage, calls } = backend();
    const result = await storage.metadata(NOTE);
    expect(result).toMatchObject({ url: `${NOTE}.meta`, etag: '"ls-abcdefghijklmnop"' });
    expect(calls.map(({ method }) => method)).toEqual(["HEAD", "GET"]);
    expect(calls[1]?.headers.get("accept")).toBe("application/linkset+json");
    expect(result.links.get(NOTE)).toEqual(
      new Map([
        ["up", [{ href: CONTAINER, params: {} }]],
        ["type", [{ href: `${LWS}DataResource`, params: {} }]],
        ["self", [{ href: NOTE, params: {} }]],
      ]),
    );
    expect(result.raw).toEqual(JSON.parse(lwsReadExchanges[`GET ${NOTE}.meta`]?.body ?? "null"));
  });

  test("resolves anchors/hrefs, merges contexts and rels; only string params survive", async () => {
    const raw = {
      linkset: [
        {
          anchor: "note-0000.ttl",
          author: [
            {
              href: "../alice",
              title: "Alice",
              type: "text/plain",
              hreflang: ["en"],
              "title*": [{ value: "A", language: "en" }],
              ext: 3,
            },
          ],
        },
        { anchor: NOTE, author: [{ href: "#me" }], license: [{ href: "urn:license:test" }] },
        { anchor: FOREIGN, related: [{ href: "./other" }] },
        { anchor: "", empty: [] },
      ],
    };
    const { storage, calls } = metadata(raw, "application/json; charset=utf-8");
    const result = await storage.metadata(NOTE);
    expect(result.raw).toEqual(raw);
    expect(result.links.get(NOTE)?.get("author")).toEqual([
      { href: `${ROOT}alice`, params: { title: "Alice", type: "text/plain" } },
      { href: `${NOTE}.meta#me`, params: {} },
    ]);
    expect(result.links.get(NOTE)?.get("license")?.[0]?.href).toBe("urn:license:test");
    expect(result.links.get(FOREIGN)?.get("related")?.[0]?.href).toBe(`${CONTAINER}other`);
    expect(result.links.get(`${NOTE}.meta`)?.get("empty")).toEqual([]);
    expect(calls.map(({ url }) => url)).toEqual([NOTE, `${NOTE}.meta`]);
    expect((await metadata({ linkset: [] }).storage.metadata(NOTE)).links.size).toBe(0);
  });

  test("malformed structures and references are invalid-response", async () => {
    for (const raw of [
      null,
      [],
      {},
      { linkset: {} },
      { linkset: [null] },
      { linkset: [[]] },
      { linkset: [{}] },
      { linkset: [{ anchor: 1 }] },
      { linkset: [{ anchor: "file:///tmp/x" }] },
      { linkset: [{ anchor: "http://[" }] },
      { linkset: [{ anchor: NOTE, up: {} }] },
      { linkset: [{ anchor: NOTE, up: [null] }] },
      { linkset: [{ anchor: NOTE, up: [[]] }] },
      { linkset: [{ anchor: NOTE, up: [{}] }] },
      { linkset: [{ anchor: NOTE, up: [{ href: 3 }] }] },
      { linkset: [{ anchor: NOTE, up: [{ href: "http://[" }] }] },
    ])
      await rejects(metadata(raw).storage.metadata(NOTE));
    await rejects(metadata({ linkset: [] }, "application/ld+json").storage.metadata(NOTE));
  });

  test("string attributes with hostile property names stay data", async () => {
    const raw = JSON.parse(
      `{"linkset":[{"anchor":"${NOTE}","__proto__":[{"href":"#x","__proto__":"data","constructor":"safe"}]}]}`,
    );
    const result = await metadata(raw).storage.metadata(NOTE);
    const params = result.links.get(NOTE)?.get("__proto__")?.[0]?.params;
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
    expect(params).toEqual(JSON.parse('{"__proto__":"data","constructor":"safe"}'));
  });

  test("missing or foreign linksets are unsupported without fetching them", async () => {
    for (const link of [
      "",
      `<${FOREIGN}>; rel="linkset"`,
      `<${FOREIGN}>; rel="linkset", <${NOTE}.meta>; rel="linkset"`,
    ]) {
      const { storage, calls } = backend({ [`HEAD ${NOTE}`]: { status: 200, headers: { link } } });
      await rejects(storage.metadata(NOTE), "unsupported");
      expect(calls).toHaveLength(1);
    }
  });
});

describe("bounded JSON and aborts", () => {
  test("JSON cap enforced on streamed bytes for both listing and metadata; exact cap accepted", async () => {
    const cap = 16 * 1024 * 1024;
    for (const operation of ["list", "metadata"] as const) {
      const raw = operation === "list" ? pageBody() : { linkset: [] };
      const json = JSON.stringify(raw);
      for (const excess of [0, 1]) {
        let cancelled = false;
        let supplied = false;
        const fetch: AuthFetch = async (_url, init) => {
          if (init?.method === "HEAD")
            return new Response(null, { headers: { link: `<${NOTE}.meta>; rel="linkset"` } });
          return new Response(
            new ReadableStream<Uint8Array>(
              {
                pull(controller) {
                  if (supplied) {
                    controller.close();
                    return;
                  }
                  supplied = true;
                  const bytes = new TextEncoder().encode(
                    `${json}${" ".repeat(cap + excess - json.length)}`,
                  );
                  controller.enqueue(bytes);
                },
                cancel() {
                  cancelled = true;
                },
              },
              { highWaterMark: 0 },
            ),
            {
              headers: {
                "content-type":
                  operation === "list" ? "application/lws+json" : "application/linkset+json",
                "content-length": "1",
              },
            },
          );
        };
        const storage = createLwsBackend({ root: ROOT, fetch });
        const result = storage[operation](operation === "list" ? CONTAINER : NOTE);
        if (excess) {
          await rejects(result);
          expect(cancelled).toBe(true);
        } else expect(await result).toBeDefined();
      }
    }
  });

  test("UTF-8 split across chunks survives streaming decoding", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(pageBody([{ id: "café" }])));
    const split = bytes.indexOf(0xc3) + 1;
    const storage = createLwsBackend({
      root: ROOT,
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(bytes.slice(0, split));
              c.enqueue(bytes.slice(split));
              c.close();
            },
          }),
          { headers: { "content-type": "application/lws+json" } },
        ),
    });
    expect((await storage.list(CONTAINER)).items[0]?.url).toBe(`${CONTAINER}caf%C3%A9`);
  });

  test("already aborted operations and listAll stop without fetching", async () => {
    const { storage, fetch } = backend();
    const signal = AbortSignal.abort("stop");
    for (const operation of ["list", "head", "read", "readRdf"] as const)
      expect((await rejects(storage[operation](CONTAINER, { signal }), "network")).retryable).toBe(
        false,
      );
    await rejects(collect(storage.listAll(CONTAINER, { signal })), "network");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("listAll stops between entries and before a new page", async () => {
    const { storage, calls } = backend();
    const controller = new AbortController();
    const iterator = storage
      .listAll(CONTAINER, { signal: controller.signal })
      [Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBeDefined();
    controller.abort();
    expect((await rejects(iterator.next(), "network")).retryable).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("abort during JSON collection cancels and rejects promptly", async () => {
    const controller = new AbortController();
    let cancelled = false;
    let ready: () => void = () => {};
    const reading = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const storage = createLwsBackend({
      root: ROOT,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              ready();
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "application/lws+json" } },
        ),
    });
    const listing = storage.list(CONTAINER, { signal: controller.signal });
    await reading;
    // Let JSON collection install its abort listener.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    controller.abort("stop");
    expect((await rejects(listing, "network")).retryable).toBe(false);
    expect(cancelled).toBe(true);
  });

  test("abort after headers but before collection still discards the body", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const storage = createLwsBackend({
      root: ROOT,
      fetch: async () => {
        controller.abort();
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "application/lws+json" } },
        );
      },
    });
    expect(
      (await rejects(storage.list(CONTAINER, { signal: controller.signal }), "network")).retryable,
    ).toBe(false);
    expect(cancelled).toBe(true);
  });

  test("transport and streamed body failures remain network errors", async () => {
    const failingFetch: AuthFetch = async () => {
      throw new TypeError("failed");
    };
    expect(
      (await rejects(createLwsBackend({ root: ROOT, fetch: failingFetch }).read(NOTE), "network"))
        .retryable,
    ).toBe(true);
    for (const operation of ["list", "read", "readRdf", "metadata"] as const) {
      const storage = createLwsBackend({
        root: ROOT,
        fetch: async (_input, init) => {
          if (operation === "metadata" && init?.method === "HEAD")
            return new Response(null, { headers: { link: `<${NOTE}.meta>; rel="linkset"` } });
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(c) {
                c.error(new TypeError("terminated"));
              },
            }),
            {
              headers: {
                "content-type":
                  operation === "metadata"
                    ? "application/linkset+json"
                    : operation === "list"
                      ? "application/lws+json"
                      : "text/turtle",
              },
            },
          );
        },
      });
      const promise =
        operation === "read"
          ? storage.read(NOTE).then((r) => r.text())
          : storage[operation](operation === "list" ? CONTAINER : NOTE);
      await rejects(promise, "network");
    }
  });
});

describe("construction, parentOf and pending mutations", () => {
  test("defaults and provided features, invalid roots", () => {
    const fetch = vi.fn<AuthFetch>();
    const storage = createLwsBackend({ root: ROOT, fetch });
    expect(storage.protocol).toBe("lws");
    expect(storage.root).toBe(ROOT);
    expect(storage.features.move.state).toBe("unknown");
    const features = deriveFeatures({
      protocol: "lws",
      id: ROOT,
      root: ROOT,
      descriptionUrl: null,
      services: [],
      capabilities: [],
      sources: ["probe"],
      fetchedAt: 0,
      etag: null,
      maxAgeMs: 0,
      verificationMethods: [],
    });
    expect(createLwsBackend({ root: ROOT, fetch, features }).features).toBe(features);
    for (const root of [`${ROOT}file`, `${ROOT}?`, `${ROOT}#`, `${ROOT}?q=1`, `${ROOT}#x/`])
      expect(() => createLwsBackend({ root, fetch })).toThrow(TypeError);
    expect(() => createLwsBackend({ root: FOREIGN.replace("https", "ftp"), fetch })).toThrow(
      StorageError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test("storage ids are normalised once and must be absolute HTTP(S) URLs", async () => {
    const id = "https://lws.example/storage/alice";
    const fetch = vi.fn<AuthFetch>(
      async () =>
        new Response(null, {
          headers: { link: storageLink(id) },
        }),
    );
    for (const storage of [id, "HTTPS://LWS.EXAMPLE:443/storage/../storage/alice"]) {
      const client = createLwsBackend({ root: ROOT, storage, fetch });
      expect((await client.head(NOTE)).status).toBe(200);
    }
    const before = fetch.mock.calls.length;
    for (const storage of [
      "",
      "relative",
      "/storage",
      "//lws.example/storage",
      "https://[",
      "urn:storage:alice",
      "file:///tmp/id",
      "ftp://lws.example/id",
    ]) {
      expect(() => createLwsBackend({ root: ROOT, storage, fetch })).toThrow(TypeError);
    }
    expect(fetch).toHaveBeenCalledTimes(before);
  });

  test("parentOf uses one HEAD except at root (including root aliases)", async () => {
    const { storage, calls } = backend();
    for (const url of [ROOT, ROOT.slice(0, -1), `${ROOT}?x=1`, `${ROOT}#top`])
      expect(await storage.parentOf(url)).toBeNull();
    expect(calls).toHaveLength(0);
    expect(await storage.parentOf(NOTE)).toBe(CONTAINER);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("HEAD");
    expect(
      await backend({ [`HEAD ${NOTE}`]: { status: 200, headers: {} } }).storage.parentOf(NOTE),
    ).toBeNull();
  });

  test("all mutation stubs reject unsupported without fetching until T-024", async () => {
    const { storage, fetch } = backend();
    const pending = [
      storage.write(NOTE, "x", { contentType: "text/plain", ifMatch: "*" }),
      storage.writeRdf(NOTE, [], { ifMatch: "*" }),
      storage.create(CONTAINER, null),
      storage.patch(NOTE, { kind: "json", ops: [] }, { ifMatch: '"1"' }),
      storage.move(NOTE, ROOT),
      storage.delete(NOTE),
      storage.setMetadata(NOTE, [], { ifMatch: '"1"' }),
    ];
    for (const promise of pending)
      expect((await rejects(promise, "unsupported")).message).toContain("T-024");
    expect(fetch).not.toHaveBeenCalled();
  });
});
