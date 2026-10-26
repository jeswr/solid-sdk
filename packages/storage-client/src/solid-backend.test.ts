// AUTHORED-BY Claude Opus 5.5
import { deriveFeatures } from "@jeswr/storage-capabilities";
import { DataFactory, Store } from "n3";
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
import { CSS_ROOT, cssReadExchanges, type RecordedExchanges } from "./fixtures/css.js";
import { createSolidBackend } from "./solid.js";

const NOTES = `${CSS_ROOT}notes/`;
const { namedNode, literal, quad } = DataFactory;

/**
 * Replay recorded exchanges like a server would: If-None-Match against the recorded ETag answers
 * 304, and a Range header slices the recorded body into a 206. Unknown requests are 404.
 */
function replay(exchanges: RecordedExchanges) {
  const calls: { method: string; url: string; headers: Headers; redirect?: string }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, url, headers, redirect: init?.redirect });
    const recorded = exchanges[`${method} ${url}`];
    if (!recorded) return new Response(null, { status: 404 });
    const etag = recorded.headers.etag;
    const ifNoneMatch = headers.get("if-none-match");
    if (
      ifNoneMatch !== null &&
      etag !== undefined &&
      (ifNoneMatch === "*" || ifNoneMatch === etag)
    ) {
      return new Response(null, { status: 304, headers: { etag } });
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(headers.get("range") ?? "");
    if (range && recorded.body !== undefined) {
      const bytes = new TextEncoder().encode(recorded.body);
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : bytes.byteLength - 1;
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { ...recorded.headers, "content-range": `bytes ${start}-${end}/${bytes.length}` },
      });
    }
    return new Response(method === "HEAD" ? null : (recorded.body ?? null), {
      status: recorded.status,
      headers: recorded.headers,
    });
  });
  return { fetch, calls };
}

function backend(exchanges: RecordedExchanges = cssReadExchanges) {
  const { fetch, calls } = replay(exchanges);
  return { storage: createSolidBackend({ fetch, root: CSS_ROOT }), fetch, calls };
}

async function rejects(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code });
  return error as StorageError;
}

describe("list (CSS fixture)", () => {
  test("lists direct, in-scope members with kinds, types, sizes and dates", async () => {
    const { storage, calls } = backend();
    const page = await storage.list(NOTES);
    expect(calls[0]?.headers.get("accept")).toBe("text/turtle");
    expect(calls[0]?.redirect).toBe("manual");
    expect(page).toMatchObject({ next: null, total: 3, etag: '"1790850000000-text/turtle"' });
    expect(page.items).toEqual([
      {
        url: `${NOTES}archive/`,
        kind: "container",
        contentType: null,
        size: null,
        modified: new Date("2026-09-30T08:00:00.000Z"),
        types: [],
      },
      {
        url: `${NOTES}photo.png`,
        kind: "resource",
        contentType: "image/png",
        size: 8,
        modified: null,
        types: [],
      },
      {
        url: `${NOTES}today.ttl`,
        kind: "resource",
        contentType: "text/turtle",
        size: 143,
        modified: new Date("2026-10-02T10:30:00.000Z"),
        types: ["https://schema.example/Note"],
      },
    ]);
    const all: string[] = [];
    for await (const entry of storage.listAll(NOTES)) all.push(entry.url);
    expect(all).toHaveLength(3);
  });

  test("refuses cursors, non-containers, non-RDF and malformed listings", async () => {
    const { storage } = backend();
    await rejects(storage.list(NOTES, { cursor: { url: `${NOTES}?page=2` } }), "bad-request");
    await rejects(storage.list(`${NOTES}photo.png`), "method-not-allowed");
    const html = backend({
      [`GET ${NOTES}`]: { status: 200, headers: { "content-type": "text/html" }, body: "<p/>" },
    });
    await rejects(html.storage.list(NOTES), "invalid-response");
    const broken = backend({
      [`GET ${NOTES}`]: { status: 200, headers: { "content-type": "text/turtle" }, body: "<a" },
    });
    await rejects(broken.storage.list(NOTES), "invalid-response");
    const empty = backend({
      [`GET ${NOTES}`]: { status: 200, headers: { "content-type": "text/turtle" }, body: "" },
    });
    expect((await empty.storage.list(NOTES)).items).toEqual([]);
  });

  test("tolerates odd member metadata: bad sizes, literal-free formats and duplicates", async () => {
    const odd = backend({
      [`GET ${NOTES}`]: {
        status: 200,
        headers: { "content-type": "text/turtle" },
        body: `@prefix posix: <http://www.w3.org/ns/posix/stat#>.
          <> <http://www.w3.org/ns/ldp#contains> <a>, <b>, <c>.
          <a> posix:size -1; <http://purl.org/dc/terms/format> <https://not.a/literal>.
          <b> posix:size 1.5; <http://purl.org/dc/terms/modified> "not a date".
          <c> a <http://www.w3.org/ns/ldp#BasicContainer>.`,
      },
    });
    const { items } = await odd.storage.list(NOTES);
    expect(
      items.map(({ url, kind, size, contentType }) => ({ url, kind, size, contentType })),
    ).toEqual([
      { url: `${NOTES}a`, kind: "resource", size: null, contentType: null },
      { url: `${NOTES}b`, kind: "resource", size: null, contentType: null },
      { url: `${NOTES}c`, kind: "container", size: null, contentType: null },
    ]);
  });
});

describe("head / read / readRdf", () => {
  test("head exposes ETag, type, describedby, parent, WAC-Allow and no body", async () => {
    const { storage, calls } = backend();
    const result = await storage.head(`${NOTES}today.ttl`);
    expect(calls[0]).toMatchObject({ method: "HEAD" });
    expect(result).toMatchObject({
      url: `${NOTES}today.ttl`,
      status: 200,
      etag: '"1790937000000-text/turtle"',
      contentType: "text/turtle",
      lastModified: new Date("2026-10-02T10:30:00.000Z"),
      body: null,
      parent: NOTES,
      metadataUrl: `${NOTES}today.ttl.meta`,
      kind: "resource",
      allow: { read: true, write: true, append: true, control: true },
    });
    expect(result.links.get("acl")).toEqual([{ target: `${NOTES}today.ttl.acl`, params: {} }]);
    expect(await result.text()).toBe("");
  });

  test("read returns bytes once buffered, a 206 for ranges and a 304 for a matching ETag", async () => {
    const { storage, calls } = backend();
    const photo = await storage.read(`${NOTES}photo.png`);
    expect(photo).toMatchObject({ status: 200, contentType: "image/png", kind: "resource" });
    expect(photo.allow).toEqual({ read: true, write: false, append: false, control: false });
    expect(await photo.text()).toBe("PNGBYTES");
    expect(await photo.bytes()).toEqual(new TextEncoder().encode("PNGBYTES"));
    expect((await photo.blob()).type).toBe("image/png");
    const part = await storage.read(`${NOTES}photo.png`, { range: { start: 3, end: 5 } });
    expect(calls.at(-1)?.headers.get("range")).toBe("bytes=3-5");
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("BYT");
    const tail = await storage.read(`${NOTES}photo.png`, { range: { start: 6 } });
    expect(await tail.text()).toBe("ES");
    const cached = await storage.read(`${NOTES}photo.png`, {
      ifNoneMatch: '"1790900000000-image/png"',
      accept: "image/*",
    });
    expect(calls.at(-1)?.headers.get("accept")).toBe("image/*");
    expect(cached).toMatchObject({ status: 304, body: null });
    expect(await cached.bytes()).toEqual(new Uint8Array());
    await expect(storage.read(`${NOTES}photo.png`, { range: { start: -1 } })).rejects.toThrow(
      RangeError,
    );
    await expect(
      storage.read(`${NOTES}photo.png`, { range: { start: 4, end: 2 } }),
    ).rejects.toThrow(RangeError);
    await expect(storage.read(`${NOTES}photo.png`, { range: { start: 0.5 } })).rejects.toThrow(
      RangeError,
    );
  });

  test("link parameters, anchored links, bad dates and untyped blobs", async () => {
    const { storage } = backend({
      [`GET ${NOTES}a`]: {
        status: 200,
        headers: {
          "last-modified": "yesterday",
          link: [
            `<${NOTES}a.meta>; rel="describedby"; title="Meta"; title="Again"; type="text/turtle"`,
            `<${NOTES}other>; rel="related"; anchor="${NOTES}b"`,
            `<${NOTES}x>; rel="alternate next"`,
          ].join(", "),
        },
      },
    });
    const result = await storage.read(`${NOTES}a`);
    expect(result.lastModified).toBeNull();
    expect(result.links.get("describedby")).toEqual([
      { target: `${NOTES}a.meta`, params: { title: "Meta", type: "text/turtle" } },
    ]);
    expect(result.links.has("related")).toBe(false);
    expect(result.links.get("next")).toEqual(result.links.get("alternate"));
    expect(result.allow).toBeNull();
    const bare = createSolidBackend({
      root: CSS_ROOT,
      fetch: async () => new Response(new Uint8Array([1]), { status: 200 }),
    });
    expect((await (await bare.read(`${NOTES}a`)).blob()).type).toBe("");
  });

  test("unread bodies are released even when cancelling fails", async () => {
    const failingCancel = () =>
      new ReadableStream<Uint8Array>({
        pull() {},
        cancel() {
          throw new Error("cancel failed");
        },
      });
    const storage = createSolidBackend({
      root: CSS_ROOT,
      fetch: async (_input, init) =>
        new Response(failingCancel(), {
          status: 200,
          headers: { "content-type": init?.method === "HEAD" ? "text/plain" : "image/png" },
        }),
    });
    expect((await storage.head(`${NOTES}a`)).body).toBeNull();
    await rejects(storage.readRdf(`${NOTES}a`), "not-rdf");
    await rejects(storage.list(`${NOTES}a`), "method-not-allowed");
  });

  test("the body stream is exposed for streaming reads", async () => {
    const { storage } = backend();
    const result = await storage.read(`${NOTES}photo.png`);
    const text = await new Response(result.body).text();
    expect(text).toBe("PNGBYTES");
  });

  test("readRdf parses Turtle isomorphically, reports 304 and refuses non-RDF", async () => {
    const { storage, calls } = backend();
    const result = await storage.readRdf(`${NOTES}today.ttl`);
    expect(calls[0]?.headers.get("accept")).toBe("text/turtle, application/ld+json;q=0.9");
    const expected = new Store([
      quad(
        namedNode(`${NOTES}today.ttl`),
        namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        namedNode("https://schema.example/Note"),
      ),
      quad(
        namedNode(`${NOTES}today.ttl`),
        namedNode("https://schema.example/text"),
        literal("Buy oat milk"),
      ),
    ]);
    expect(result.dataset.size).toBe(expected.size);
    for (const q of expected) expect(result.dataset.has(q)).toBe(true);
    expect(result).toMatchObject({
      contentType: "text/turtle",
      etag: '"1790937000000-text/turtle"',
    });
    const unchanged = await storage.readRdf(`${NOTES}today.ttl`, {
      ifNoneMatch: '"1790937000000-text/turtle"',
    });
    expect(unchanged).toMatchObject({ notModified: true, etag: '"1790937000000-text/turtle"' });
    expect(unchanged.dataset.size).toBe(0);
    await rejects(storage.readRdf(`${NOTES}photo.png`), "not-rdf");
    const broken = backend({
      [`GET ${NOTES}x.ttl`]: { status: 200, headers: { "content-type": "text/turtle" }, body: "<" },
    });
    await rejects(broken.storage.readRdf(`${NOTES}x.ttl`), "not-rdf");
    const untyped = createSolidBackend({
      root: CSS_ROOT,
      fetch: async () => new Response(new Uint8Array([120]), { status: 200 }),
    });
    const error = await rejects(untyped.readRdf(`${NOTES}x`), "not-rdf");
    expect(error.message).toContain("untyped");
  });

  test("HTTP errors map through the ADR-003 error model", async () => {
    const { storage } = backend({
      [`GET ${NOTES}secret`]: {
        status: 403,
        headers: { "content-type": "application/problem+json" },
        body: JSON.stringify({ title: "Forbidden" }),
      },
      [`GET ${NOTES}moved`]: { status: 302, headers: { location: "https://evil.example/" } },
      [`GET ${NOTES}partial`]: { status: 206, headers: {}, body: "x" },
    });
    const forbidden = await rejects(storage.read(`${NOTES}secret`), "forbidden");
    expect(forbidden.problem).toEqual({ title: "Forbidden" });
    await rejects(storage.read(`${NOTES}missing`), "not-found");
    await rejects(storage.read(`${NOTES}moved`), "invalid-response");
    await rejects(storage.read(`${NOTES}partial`), "invalid-response");
    // A 304 without a conditional request is not a success.
    const unsolicited = backend({ [`GET ${NOTES}a`]: { status: 304, headers: {} } });
    await rejects(unsolicited.storage.read(`${NOTES}a`), "invalid-response");
  });
});

describe("scope, transport and aborts", () => {
  test("a foreign or unsafe URL is a scope error before any fetch", async () => {
    const { storage, fetch } = backend();
    for (const url of [
      "https://evil.example/alice/notes/",
      "https://css.example/bob/x",
      `${CSS_ROOT}..%2fbob/x`,
      "https://user:pass@css.example/alice/x",
      "not a url",
    ]) {
      await rejects(storage.read(url), "scope");
      await rejects(storage.list(url), "scope");
      await rejects(storage.head(url), "scope");
      await rejects(storage.parentOf(url), "scope");
      expect(storage.isWithinStorage(url)).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.isWithinStorage(`${NOTES}today.ttl`)).toBe(true);
    expect(await storage.parentOf(`${NOTES}today.ttl`)).toBe(NOTES);
    expect(await storage.parentOf(CSS_ROOT)).toBeNull();
  });

  test("transport failures are retryable network errors; aborts are not", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const storage = createSolidBackend({ fetch, root: CSS_ROOT });
    const error = await rejects(storage.read(`${NOTES}a`), "network");
    expect(error.retryable).toBe(true);
    const controller = new AbortController();
    controller.abort();
    const aborted = await rejects(
      storage.read(`${NOTES}a`, { signal: controller.signal }),
      "network",
    );
    expect(aborted.retryable).toBe(false);
    const late = new AbortController();
    const abortingFetch = vi.fn<typeof globalThis.fetch>(async () => {
      late.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const lateStorage = createSolidBackend({ fetch: abortingFetch, root: CSS_ROOT });
    expect(
      (await rejects(lateStorage.head(`${NOTES}a`, { signal: late.signal }), "network")).retryable,
    ).toBe(false);
    expect(abortingFetch.mock.calls[0]?.[1]?.signal).toBe(late.signal);
  });
});

describe("metadata, construction and pending writes", () => {
  test("metadata reads the describedby document as rel maps", async () => {
    const { storage } = backend();
    const metadata = await storage.metadata(`${NOTES}today.ttl`);
    expect(metadata.url).toBe(`${NOTES}today.ttl.meta`);
    expect(metadata.etag).toBe('"1790937000001-text/turtle"');
    expect(metadata.links.get(`${NOTES}today.ttl`)).toEqual(
      new Map([
        ["https://schema.example/license", [{ href: "https://license.example/cc0", params: {} }]],
        [
          "http://www.iana.org/assignments/relation/author",
          [{ href: "https://id.example/alice#me", params: {} }],
        ],
      ]),
    );
    expect((metadata.raw as Store).size).toBe(2);
    const literalOnly = backend({
      [`HEAD ${NOTES}a`]: {
        status: 200,
        headers: { link: `<${NOTES}a.meta>; rel="describedby"` },
      },
      [`GET ${NOTES}a.meta`]: {
        status: 200,
        headers: { "content-type": "text/turtle" },
        body: `<${NOTES}a> <https://schema.example/p> "literal"; <https://schema.example/q> <x>, <y>.
          _:b <https://schema.example/p> <z>.`,
      },
    });
    const links = (await literalOnly.storage.metadata(`${NOTES}a`)).links;
    expect([...links.keys()]).toEqual([`${NOTES}a`]);
    expect(links.get(`${NOTES}a`)?.get("https://schema.example/q")).toHaveLength(2);
    const none = backend({ [`HEAD ${NOTES}a`]: { status: 200, headers: {} } });
    await rejects(none.storage.metadata(`${NOTES}a`), "unsupported");
  });

  test("construction validates the root and derives default features", () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const storage = createSolidBackend({ fetch, root: CSS_ROOT });
    expect(storage.protocol).toBe("solid");
    expect(storage.root).toBe(CSS_ROOT);
    expect(storage.features.move.state).toBe("available");
    expect(storage.features.accessControl.state).toBe("unknown");
    const features = deriveFeatures({
      protocol: "solid",
      id: CSS_ROOT,
      root: CSS_ROOT,
      descriptionUrl: `${CSS_ROOT}.well-known/solid`,
      services: [],
      capabilities: [],
      sources: ["solid-description"],
      fetchedAt: 0,
      etag: null,
      maxAgeMs: 0,
      verificationMethods: [],
    });
    expect(createSolidBackend({ fetch, root: CSS_ROOT, features }).features).toBe(features);
    expect(() => createSolidBackend({ fetch, root: "ftp://css.example/" })).toThrow(StorageError);
    expect(() => createSolidBackend({ fetch, root: "https://css.example/alice?x=1" })).toThrow(
      TypeError,
    );
  });

  test("writes reject with unsupported until T-022", async () => {
    const { storage, fetch } = backend();
    const url = `${NOTES}x`;
    const pending = [
      storage.write(url, "x", { contentType: "text/plain", ifMatch: "*" }),
      storage.writeRdf(url, [], { ifMatch: "*" }),
      storage.create(NOTES, "x", { contentType: "text/plain" }),
      storage.patch(url, { kind: "json", ops: [] }, { ifMatch: '"1"' }),
      storage.move(url, NOTES, { ifMatch: '"1"' }),
      storage.delete(url, { ifMatch: '"1"' }),
      storage.setMetadata(url, [], { ifMatch: '"1"' }),
    ];
    for (const promise of pending) await rejects(promise, "unsupported");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("review round 1 regressions", () => {
  test("body failures are network errors; aborted ones are not retryable", async () => {
    const failing = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new TypeError("terminated"));
        },
      });
    const storage = createSolidBackend({
      root: CSS_ROOT,
      fetch: async () =>
        new Response(failing(), { status: 200, headers: { "content-type": "text/turtle" } }),
    });
    const text = await rejects((await storage.read(`${NOTES}a`)).text(), "network");
    expect(text.retryable).toBe(true);
    await rejects(storage.readRdf(`${NOTES}a`), "network");
    await rejects(storage.list(NOTES), "network");
    const controller = new AbortController();
    const result = await storage.read(`${NOTES}a`, { signal: controller.signal });
    controller.abort();
    expect((await rejects(result.text(), "network")).retryable).toBe(false);
  });

  test("the streaming body maps failures and aborts to network errors, and forwards cancel", async () => {
    const failing = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new TypeError("terminated"));
        },
      });
    const storage = createSolidBackend({
      root: CSS_ROOT,
      fetch: async () =>
        new Response(failing(), { status: 200, headers: { "content-type": "text/plain" } }),
    });
    const streamed = (await storage.read(`${NOTES}a`)).body as ReadableStream<Uint8Array>;
    const error = await rejects(streamed.getReader().read(), "network");
    expect(error.retryable).toBe(true);
    const controller = new AbortController();
    const aborted = await storage.read(`${NOTES}a`, { signal: controller.signal });
    controller.abort();
    const reader = (aborted.body as ReadableStream<Uint8Array>).getReader();
    expect((await rejects(reader.read(), "network")).retryable).toBe(false);

    let cancelled: unknown;
    const endless = createSolidBackend({
      root: CSS_ROOT,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              c.enqueue(new TextEncoder().encode("x"));
            },
            cancel(reason) {
              cancelled = reason;
            },
          }),
          { status: 200, headers: { "content-type": "text/plain" } },
        ),
    });
    const live = (await endless.read(`${NOTES}a`)).body as ReadableStream<Uint8Array>;
    const liveReader = live.getReader();
    expect((await liveReader.read()).value).toEqual(new TextEncoder().encode("x"));
    await liveReader.cancel("done");
    expect(cancelled).toBe("done");
  });

  test("odd rdf:type objects and numeric posix:mtime never drop a member", async () => {
    const odd = backend({
      [`GET ${NOTES}`]: {
        status: 200,
        headers: { "content-type": "text/turtle" },
        body: `@prefix posix: <http://www.w3.org/ns/posix/stat#>.
          <> <http://www.w3.org/ns/ldp#contains> <a>, <b>, <c>.
          <a> a "bad", <https://schema.example/Note>; posix:mtime 1790937000.
          <b> posix:mtime "soon".
          <c> posix:mtime 1e300.`,
      },
    });
    const { items } = await odd.storage.list(NOTES);
    expect(items.map(({ url, types, modified }) => ({ url, types, modified }))).toEqual([
      {
        url: `${NOTES}a`,
        types: ["https://schema.example/Note"],
        modified: new Date(1790937000_000),
      },
      { url: `${NOTES}b`, types: [], modified: null },
      { url: `${NOTES}c`, types: [], modified: null },
    ]);
  });

  test("scope errors never echo credentials; the slashless root is the root", async () => {
    const { storage } = backend();
    const error = await rejects(storage.read("https://user:secret@evil.example/x"), "scope");
    expect(error.message).not.toContain("secret");
    expect(error.url).not.toContain("secret");
    expect(await storage.parentOf("https://css.example/alice")).toBeNull();
  });

  test("backslash authorities never echo credentials, parseable or not", async () => {
    const { storage } = backend();
    for (const url of [
      String.raw`https:\\user:secret@evil.example/x`,
      String.raw`https:/\user:secret@evil.example/x`,
      String.raw`not a url \\user:secret@evil.example/x`,
    ]) {
      const error = await rejects(storage.read(url), "scope");
      expect(error.message).not.toContain("secret");
      expect(error.url).not.toContain("secret");
    }
  });

  test("a backslash-authority root never echoes its credentials", () => {
    let thrown: unknown;
    try {
      createSolidBackend({
        root: String.raw`https:\\user:secret@css.example/alice/`,
        fetch: async () => new Response(),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorageError);
    const error = thrown as StorageError;
    expect(error.message).not.toContain("secret");
    expect(error.url).not.toContain("secret");
    expect(String((error.cause as Error).message)).not.toContain("secret");
  });

  test("a query on the listed container keeps its direct members", async () => {
    const storage = createSolidBackend({
      root: CSS_ROOT,
      fetch: async () =>
        new Response("<> <http://www.w3.org/ns/ldp#contains> <a>, <b/c>.", {
          headers: {
            "content-type": "text/turtle",
            link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
          },
        }),
    });
    expect((await storage.list(`${CSS_ROOT}?x=1`)).items.map((item) => item.url)).toEqual([
      `${CSS_ROOT}a`,
    ]);
  });

  test("root aliases with a query or fragment stay the root", async () => {
    const fetched: string[] = [];
    const storage = createSolidBackend({
      root: CSS_ROOT,
      fetch: async (input) => {
        fetched.push(String(input));
        return new Response("x", { status: 200, headers: { "content-type": "text/plain" } });
      },
    });
    expect(await storage.parentOf("https://css.example/alice?x=1")).toBeNull();
    expect(await storage.parentOf("https://css.example/alice#top")).toBeNull();
    const result = await storage.read("https://css.example/alice?x=1");
    expect(result.parent).toBeNull();
    expect(fetched).toEqual([`${CSS_ROOT}?x=1`]);
  });

  test("unexpected successes are invalid-response", async () => {
    const { storage } = backend({
      [`GET ${NOTES}`]: { status: 204, headers: { "content-type": "text/turtle" } },
    });
    await rejects(storage.list(NOTES), "invalid-response");
  });
});
