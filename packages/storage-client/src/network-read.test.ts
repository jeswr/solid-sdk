// AUTHORED-BY Codex GPT-6.1-Sol
// Shared security regressions exercised through both public network backends.
import { LinkHeaderOverflowError } from "@jeswr/storage-capabilities";
import { DataFactory } from "n3";
import { describe, expect, test, vi } from "vitest";
import { MAX_PROBLEM_BYTES, StorageError } from "./errors.js";
import { CSS_ROOT, cssReadExchanges } from "./fixtures/css.js";
import { scoped } from "./http.js";
import { createLwsBackend } from "./lws.js";
import { createSolidBackend } from "./solid.js";
import type { AuthFetch } from "./types.js";

const ROOT = "https://lws.example/";
const NOTE = `${ROOT}notes/a`;
const LWS = "https://www.w3.org/ns/lws#";
const factories = [
  { protocol: "solid", create: createSolidBackend },
  { protocol: "lws", create: createLwsBackend },
] as const;

describe.each(factories)("$protocol RDF negotiation errors", ({ create, protocol }) => {
  test.each([406, 501])("readRdf maps %i to not-rdf with the original details", async (status) => {
    const problem = {
      type: "https://example.org/problems/no-converter",
      title: "Cannot serve RDF",
      detail: "PRIVATE response detail",
      instance: "/request/1",
      formats: ["text/plain"],
    };
    const fetch = vi.fn<AuthFetch>(async () =>
      Response.json(problem, { status, headers: { "content-type": "application/problem+json" } }),
    );
    const storage = create({ root: ROOT, fetch });
    const signal = new AbortController().signal;
    const error = await storage
      .readRdf("HTTPS://LWS.EXAMPLE:443/notes/a", { ifNoneMatch: '"v1"', signal })
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({
      code: "not-rdf",
      status,
      url: NOTE,
      method: "GET",
      problem,
      retryable: false,
      retryAfterMs: null,
    });
    expect((error as StorageError).message).toBe(`GET ${NOTE} failed: not-rdf (${status})`);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(NOTE, {
      method: "GET",
      headers: { Accept: "text/turtle, application/ld+json;q=0.9", "If-None-Match": '"v1"' },
      redirect: "manual",
      signal,
    });
  });

  test.each<[number, string]>([
    [406, "bad-request"],
    [501, "server"],
  ])("other operations retain %i -> %s", async (status, code) => {
    const storage = create({ root: ROOT, fetch: async () => new Response(null, { status }) });
    const inserts = [
      DataFactory.quad(
        DataFactory.namedNode(NOTE),
        DataFactory.namedNode("urn:p"),
        DataFactory.literal("value"),
      ),
    ];
    for (const operation of [
      () => storage.read(NOTE),
      () => storage.read(NOTE, { accept: "text/turtle, application/ld+json;q=0.9" }),
      () => storage.head(NOTE),
      () => storage.list(ROOT),
      () => storage.write(NOTE, "body", { contentType: "text/plain", ifMatch: '"v1"' }),
      () => storage.patch(NOTE, { kind: "rdf", inserts, deletes: [] }, { ifMatch: '"v1"' }),
    ]) {
      await expect(operation()).rejects.toMatchObject({ code, status });
    }

    const metadataUrl = `${NOTE}.meta`;
    const fetch = vi.fn<AuthFetch>(async (_input, init) =>
      init?.method === "HEAD"
        ? new Response(null, {
            headers: {
              link: `<${metadataUrl}>; rel="${protocol === "solid" ? "describedby" : "linkset"}"`,
            },
          })
        : new Response(null, { status }),
    );
    const metadataStorage = create({ root: ROOT, fetch });
    await expect(metadataStorage.metadata(NOTE)).rejects.toMatchObject({
      code,
      status,
      method: "GET",
      url: metadataUrl,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("accept")).toBe(
      protocol === "solid" ? "text/turtle, application/ld+json;q=0.9" : "application/linkset+json",
    );
  });

  test.each([406, 501])("readRdf does not read non-JSON error bodies on %i", async (status) => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const storage = create({
      root: ROOT,
      fetch: async () =>
        new Response(new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }), {
          status,
          headers: { "content-type": "text/plain" },
        }),
    });
    await expect(storage.readRdf(NOTE)).rejects.toMatchObject({
      code: "not-rdf",
      status,
      problem: null,
    });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  test.each([406, 501])("readRdf retains the problem body limit on %i", async (status) => {
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(new Uint8Array(MAX_PROBLEM_BYTES + 1));
    });
    const cancel = vi.fn();
    const storage = create({
      root: ROOT,
      fetch: async () =>
        new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
          status,
          headers: { "content-type": "application/problem+json" },
        }),
    });
    await expect(storage.readRdf(NOTE)).rejects.toMatchObject({
      code: "not-rdf",
      status,
      problem: null,
    });
    expect(pull).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  test.each([406, 501])("an abort while reading a %i problem stays network", async (status) => {
    const controller = new AbortController();
    const storage = create({
      root: ROOT,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(body) {
              controller.abort("stop");
              body.close();
            },
          }),
          { status, headers: { "content-type": "application/problem+json" } },
        ),
    });
    await expect(storage.readRdf(NOTE, { signal: controller.signal })).rejects.toMatchObject({
      code: "network",
      status: null,
      retryable: false,
    });
  });

  test("readRdf preserves unexpected errors unchanged", async () => {
    const error = new Error("header access failed");
    const response = new Response(null);
    const get = response.headers.get.bind(response.headers);
    vi.spyOn(response.headers, "get").mockImplementation((name) => {
      if (name === "content-type") throw error;
      return get(name);
    });
    const storage = create({ root: ROOT, fetch: async () => response });
    await expect(storage.readRdf(NOTE)).rejects.toBe(error);
  });

  test.each<[number, string, boolean]>([
    [302, "invalid-response", false],
    [403, "forbidden", false],
    [500, "server", false],
    [503, "server", true],
  ])("readRdf retains %i -> %s", async (status, code, retryable) => {
    const fetch = vi.fn<AuthFetch>(async () => new Response(null, { status }));
    const storage = create({ root: ROOT, fetch });
    await expect(storage.readRdf(NOTE)).rejects.toMatchObject({ code, status, retryable });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  if (protocol === "lws") {
    test.each([
      406, 501,
    ])("readRdf keeps a foreign storage binding as scope on %i", async (status) => {
      const storage = create({
        root: ROOT,
        fetch: async () =>
          new Response(null, {
            status,
            headers: { link: `<https://foreign.example/>; rel="${LWS}storage"` },
          }),
      });
      await expect(storage.readRdf(NOTE)).rejects.toMatchObject({
        code: "scope",
        status: null,
        url: NOTE,
        method: "GET",
      });
    });
  }
});

describe.each(factories)("$protocol observation revalidation", ({ create, protocol }) => {
  test("keeps request headers local and forwards them on every listing page", async () => {
    const requests: Request[] = [];
    const storage = create({
      root: ROOT,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.method === "HEAD") return new Response(null);
        if (protocol === "solid")
          return new Response("", { headers: { "content-type": "text/turtle" } });
        return Response.json(
          { type: "Container", items: [] },
          {
            headers: {
              "content-type": "application/lws+json",
              ...(request.url === ROOT ? { link: '<?page=2>; rel="next"' } : {}),
            },
          },
        );
      },
    });
    const headers = new Headers({
      "x-warm-request": "crawl",
      Accept: "invalid",
      Range: "bytes=0-1",
      "If-None-Match": "invalid",
    });
    await storage.head(NOTE, { headers });
    await storage.read(NOTE, {
      headers,
      accept: "text/plain",
      ifNoneMatch: '"v1"',
      range: { start: 2, end: 3 },
    });
    await Array.fromAsync(storage.listAll(ROOT, { headers }));
    for (const request of requests) expect(request.headers.get("x-warm-request")).toBe("crawl");
    expect(requests[0]?.headers.get("accept")).toBe("*/*");
    expect(requests[0]?.headers.has("range")).toBe(false);
    expect(requests[0]?.headers.has("if-none-match")).toBe(false);
    expect(requests[1]?.headers.get("accept")).toBe("text/plain");
    expect(requests[1]?.headers.get("range")).toBe("bytes=2-3");
    expect(requests[1]?.headers.get("if-none-match")).toBe('"v1"');
    expect(requests.slice(2)).toHaveLength(protocol === "solid" ? 1 : 2);
    for (const request of requests.slice(2)) {
      expect(request.headers.get("accept")).toBe(
        protocol === "solid" ? "text/turtle" : "application/lws+json, application/ld+json;q=0.5",
      );
      expect(request.headers.has("range")).toBe(false);
      expect(request.headers.has("if-none-match")).toBe(false);
    }
    await storage.read(NOTE);
    expect(requests.at(-1)?.headers.has("x-warm-request")).toBe(false);
    expect(headers.get("accept")).toBe("invalid");
  });

  test.each([
    undefined,
    false,
    true,
  ])("forwards revalidate=%s to HEAD and every listing page", async (revalidate) => {
    const signal = new AbortController().signal;
    const fetch = vi.fn<AuthFetch>(async (input, init) => {
      if (init?.method === "HEAD") return new Response(null);
      if (protocol === "solid") {
        return new Response("", { headers: { "content-type": "text/turtle" } });
      }
      const next = String(input) === ROOT;
      return Response.json(
        { type: "Container", items: [{ id: next ? "a" : "b", type: "DataResource" }] },
        {
          headers: {
            "content-type": "application/lws+json",
            ...(next ? { link: '<?page=2&opaque=a%2Fb>; rel="next"' } : {}),
          },
        },
      );
    });
    const storage = create({ root: ROOT, fetch });
    await storage.head(NOTE, { signal, revalidate });
    await storage.list(ROOT, { signal, revalidate });
    const entries = await Array.fromAsync(storage.listAll(ROOT, { signal, revalidate }));
    expect(entries.map((entry) => entry.url)).toEqual(
      protocol === "lws" ? [`${ROOT}a`, `${ROOT}b`] : [],
    );
    expect(fetch).toHaveBeenCalledTimes(protocol === "lws" ? 4 : 3);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.cache).toBe(revalidate ? "no-cache" : undefined);
      expect(init?.signal).toBe(signal);
      expect(init?.redirect).toBe("manual");
    }
    if (protocol === "lws") {
      expect(fetch.mock.calls.at(-1)?.[0]).toBe(`${ROOT}?page=2&opaque=a%2Fb`);
    }
  });
});

describe.each(factories)("$protocol request scope", ({ create, protocol }) => {
  test.each([
    "https://alice:SECRET@evil.example/",
    "https://alice:SECRET@lws.example/storage/",
    "https:alice:SECRET@evil.example/",
    String.raw`https:\\alice:SECRET@evil.example/`,
  ])("listAll scopes %s before checking an already-aborted signal", async (url) => {
    const fetch = vi.fn<AuthFetch>();
    const storage = create({ root: `${ROOT}storage/`, fetch });
    const signal = AbortSignal.abort("stop");
    const expected = await storage.list(url, { signal }).catch((error: StorageError) => error);
    const error = await Array.fromAsync(storage.listAll(url, { signal })).catch(
      (error: StorageError) => error,
    );
    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ code: "scope", url: expected.url, message: expected.message });
    expect([error.message, error.url, String(error.cause)].join("\n")).not.toContain("SECRET");
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    "?",
    "#",
    "?page=1",
    "#top",
  ])("listAll rejects container suffix %s before checking an already-aborted signal", async (suffix) => {
    const root = `${ROOT}storage/`;
    const url = `${root.slice(0, -1)}${suffix}`;
    const fetch = vi.fn<AuthFetch>();
    const storage = create({ root, fetch });
    const signal = AbortSignal.abort("stop");
    const expected = await storage.list(url, { signal }).catch((error: StorageError) => error);
    const error = await Array.fromAsync(storage.listAll(url, { signal })).catch(
      (error: StorageError) => error,
    );
    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({
      code: "bad-request",
      url: expected.url,
      message: expected.message,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("listAll uses the canonical container in abort errors before the first request", async () => {
    const root = `${ROOT}storage/`;
    const url = "HTTPS://LWS.EXAMPLE:443/SECRET/../storage";
    const fetch = vi.fn<AuthFetch>();
    const storage = create({ root, fetch });
    const error = await Array.fromAsync(
      storage.listAll(url, { signal: AbortSignal.abort("stop") }),
    ).catch((error: StorageError) => error);
    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ code: "network", retryable: false, url: root });
    expect([error.message, error.url, String(error.cause)].join("\n")).not.toContain("SECRET");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("listAll uses the canonical container when aborted at a page boundary", async () => {
    const root = `${ROOT}storage/`;
    const url = "HTTPS://LWS.EXAMPLE:443/SECRET/../storage";
    const fixture = cssReadExchanges[`GET ${CSS_ROOT}notes/`];
    const fetch = vi.fn<AuthFetch>(async () =>
      protocol === "solid"
        ? new Response(fixture?.body, { headers: fixture?.headers })
        : new Response(JSON.stringify({ type: "Container", items: [{ id: "child" }] }), {
            headers: { "content-type": "application/lws+json", link: "<?page=2>; rel=next" },
          }),
    );
    const storage = create({ root, fetch });
    const list = vi.spyOn(storage, "list");
    const controller = new AbortController();
    const iterator = storage.listAll(url, { signal: controller.signal })[Symbol.asyncIterator]();
    for (let i = 0; i < (protocol === "solid" ? 3 : 1); i++)
      expect((await iterator.next()).value).toBeDefined();
    controller.abort("stop");
    const error = await iterator.next().catch((error: StorageError) => error);
    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ code: "network", retryable: false, url: root });
    expect([error.message, error.url, String(error.cause)].join("\n")).not.toContain("SECRET");
    expect(list).toHaveBeenCalledWith(root, { cursor: undefined, signal: controller.signal });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(root);
  });

  test.each([
    "https:evil.example/steal",
    "https:alice:SECRET@evil.example/steal",
    "https:/x",
    "https:/alice:SECRET@evil.example/steal",
    String.raw`https:\evil.example/steal`,
    String.raw`https:\alice:SECRET@evil.example/steal`,
    String.raw`https:\\alice:SECRET@evil.example/steal`,
    String.raw`https:/\alice:SECRET@evil.example/steal`,
    // Even an in-scope standalone parse is refused when resolving against root differs.
    "https:lws.example/notes/",
    "https:/lws.example/notes/",
    String.raw`https:\lws.example/notes/`,
  ])("refuses ambiguous URL %s on every read path, before authenticated fetch", async (url) => {
    const requests: Request[] = [];
    const fetch = vi.fn<AuthFetch>(async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", "Bearer probe");
      const request = new Request(input, { ...init, headers });
      requests.push(request);
      return new Response(null);
    });
    const storage = create({ root: ROOT, fetch });
    const operations = [
      () => storage.list(ROOT, { cursor: { url } }),
      () => storage.list(url),
      () => storage.read(url),
      () => storage.readRdf(url),
      () => storage.head(url),
      () => storage.metadata(url),
      () => storage.parentOf(url),
    ];
    for (const operation of operations) {
      const error = await operation().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(StorageError);
      expect(error).toMatchObject({ code: "scope" });
      const scoped = error as StorageError;
      expect(scoped.url).not.toContain("SECRET");
      expect(scoped.message).not.toContain("SECRET");
      expect(String(scoped.cause)).not.toContain("SECRET");
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(storage.isWithinStorage(url)).toBe(false);

    // The injected transport uses Fetch's standalone Request parser and adds credentials.
    const result = await storage.head("HTTPS://LWS.EXAMPLE:443/a/../safe?token=a%2fb&x=1&x=2");
    expect(result.url).toBe(`${ROOT}safe?token=a%2fb&x=1&x=2`);
    expect(requests.map(({ url }) => url)).toEqual([result.url]);
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer probe");
    expect(fetch.mock.calls[0]?.[0]).toBe(result.url);
  });

  test.each([
    ["https://lws.example/storage/", true],
    ["https://lws.example/storage", true],
    ["https://lws.example/storage?x=1#top", true],
    ["https://lws.example/storage/note?token=a%2fb&x=1&x=2", true],
    ["HTTPS://LWS.EXAMPLE:443/storage/a/../note", true],
    [String.raw`https:\\lws.example\storage\note`, true],
    ["https://lws.example/storage/child/../note", true],
    ["https://lws.example/storage/../outside", false],
    ["https://lws.example/storage-other/note", false],
    ["https://lws.example/", false],
    ["https://evil.example/storage/note", false],
    ["https://user:secret@lws.example/storage/note", false],
    ["http://lws.example/storage/note", false],
    ["file:///storage/note", false],
    ["https://lws.example/storage/..%2foutside", false],
    ["https://lws.example/storage/..%5coutside", false],
    ["https:evil.example/x", false],
    ["https:lws.example/storage/note", false],
    ["https:/lws.example/storage/note", false],
    [String.raw`https:\lws.example/storage/note`, false],
    ["//lws.example/storage/note", false],
    ["/storage/note", false],
    ["note", false],
    ["https://[", false],
    ["", false],
  ])("predicate agrees with scoped and HEAD for %s", async (url, expected) => {
    const root = `${ROOT}storage/`;
    const fetch = vi.fn<AuthFetch>(async () => new Response(null));
    const storage = create({ root, fetch });
    let accepted = false;
    try {
      scoped(root, "HEAD", url);
      accepted = true;
    } catch (error) {
      expect(error).toMatchObject({ code: "scope" });
    }
    expect(accepted).toBe(expected);
    expect(storage.isWithinStorage(url)).toBe(accepted);
    if (accepted) {
      expect((await storage.head(url)).url).toBe(scoped(root, "HEAD", url));
    } else {
      await expect(storage.head(url)).rejects.toMatchObject({ code: "scope" });
    }
    expect(fetch).toHaveBeenCalledTimes(accepted ? 1 : 0);
  });
});

describe.each(factories)("$protocol authoritative Link bounds", ({ create, protocol }) => {
  test("accepts 1024 relative targets against a long URL within the resolved budget", async () => {
    const prefix = `${ROOT}?token=`;
    const url = `${prefix}${"x".repeat(500 - prefix.length)}`;
    const targets = Array.from({ length: 1024 }, (_, i) => `#${i}`);
    const link = targets.map((target) => `<${target}>; rel=x`).join(",");
    expect(url.length).toBeLessThan(8192);
    expect(link.length).toBeLessThan(65536);
    const storage = create({
      root: ROOT,
      fetch: async () => new Response(null, { headers: { link } }),
    });
    const result = await storage.head(url);
    expect(result.links.get("x")).toEqual(
      targets.map((target) => ({ target: `${url}${target}`, params: {} })),
    );
  });

  test.each([
    0, 1,
  ])("bounds resolved targets and implicit contexts at exactly 1 MiB (excess %i)", async (excess) => {
    const prefix = `${ROOT}?token=`;
    const url = `${prefix}${"x".repeat(511 - prefix.length)}`;
    const link = [...Array(1023).fill("<#0>; rel=x"), `<#0${"x".repeat(excess)}>; rel=x`].join(",");
    const cancel = vi.fn();
    const storage = create({
      root: ROOT,
      fetch: async () =>
        new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { link } }),
    });
    const result = storage.read(url);
    if (excess) {
      await expect(result).rejects.toMatchObject({
        code: "invalid-response",
        cause: { name: "LinkHeaderOverflowError", limit: "maxResolvedBytes" },
      });
      expect(cancel).toHaveBeenCalledTimes(1);
    } else {
      const read = await result;
      expect(read.links.get("x")).toHaveLength(1024);
      await read.body?.cancel();
    }
  });

  test("rejects expanded anchors before ignoring their foreign contexts", async () => {
    const url = `${ROOT}?token=${"x".repeat(8000)}`;
    const link = Array.from({ length: 1024 }, (_, i) => `<urn:t>; rel=x; anchor="#${i}"`).join(",");
    expect(url.length).toBeLessThan(8192);
    expect(link.length).toBeLessThan(65536);
    const storage = create({
      root: ROOT,
      fetch: async () => new Response(null, { headers: { link } }),
    });
    await expect(storage.head(url)).rejects.toMatchObject({
      code: "invalid-response",
      cause: { name: "LinkHeaderOverflowError", limit: "maxResolvedBytes" },
    });
  });

  test("deduplicates 32000 repeated relations in one 64 KiB member", async () => {
    const prefix = `<urn:t>; rel="${Array(32000).fill("a").join(" ")}"; title="`;
    const title = "x".repeat(65536 - prefix.length - 1);
    const link = `${prefix}${title}"`;
    expect(link).toHaveLength(65536);
    const storage = create({
      root: ROOT,
      fetch: async () => new Response(null, { headers: { link } }),
    });
    const result = await storage.head(NOTE);
    expect([...result.links]).toEqual([["a", [{ target: "urn:t", params: { title } }]]]);
  });

  test("preserves relation and target ordering, including duplicates across members", async () => {
    const storage = create({
      root: ROOT,
      fetch: async () =>
        new Response(null, {
          headers: {
            link: '<urn:first>; rel="a b a"; title="first", <urn:second>; rel="b a b"; title="second", <urn:first>; rel="a"',
          },
        }),
    });
    const result = await storage.head(NOTE);
    expect([...result.links]).toEqual([
      [
        "a",
        [
          { target: "urn:first", params: { title: "first" } },
          { target: "urn:second", params: { title: "second" } },
          { target: "urn:first", params: {} },
        ],
      ],
      [
        "b",
        [
          { target: "urn:first", params: { title: "first" } },
          { target: "urn:second", params: { title: "second" } },
        ],
      ],
    ]);
  });

  test.each([
    {
      name: "1025 members",
      link: Array(1025).fill("<urn:t>; rel=type").join(","),
      limit: "maxMembers",
    },
    {
      name: "more than 64 KiB",
      link: `<urn:t>; rel=type; title="${"x".repeat(65536)}"`,
      limit: "maxBytes",
    },
    // Headers combines separate values before parsing; the byte cap still applies.
    {
      name: "UTF-8 over 64 KiB",
      link: `<urn:t>; rel=type; title="${"é".repeat(32768)}"`,
      limit: "maxBytes",
    },
  ])("rejects $name and discards bodies before using any links", async ({ link, limit }) => {
    for (const operation of ["head", "read", "readRdf", "list", "metadata", "parentOf"] as const) {
      // Solid parentOf is path arithmetic and has no response to inspect.
      if (protocol === "solid" && operation === "parentOf") continue;
      for (const metadataGet of operation === "metadata" ? [false, true] : [false]) {
        let cancelled = false;
        const fetch = vi.fn<AuthFetch>(async (_input, init) => {
          if (metadataGet && init?.method === "HEAD") {
            const rel = protocol === "solid" ? "describedby" : "linkset";
            return new Response(null, { headers: { link: `<${NOTE}.meta>; rel=${rel}` } });
          }
          return new Response(
            new ReadableStream<Uint8Array>({
              cancel() {
                cancelled = true;
              },
            }),
            {
              headers: {
                // Earlier safe links and foreign bindings must not be consumed as a partial result.
                link: `<${NOTE}.meta>; rel="describedby linkset", <${ROOT}>; rel=up, <urn:type>; rel=type, ${link}, <https://foreign.example/>; rel="${LWS}storage"`,
              },
            },
          );
        });
        const storage = create({ root: ROOT, fetch });
        const error = await storage[operation](operation === "list" ? ROOT : NOTE).catch(
          (error: unknown) => error,
        );
        expect(error).toBeInstanceOf(StorageError);
        expect(error).toMatchObject({
          code: "invalid-response",
          method:
            metadataGet || !["head", "metadata", "parentOf"].includes(operation) ? "GET" : "HEAD",
          url: metadataGet ? `${NOTE}.meta` : operation === "list" ? ROOT : NOTE,
          cause: { name: "LinkHeaderOverflowError", limit },
        });
        expect((error as StorageError).cause).toBeInstanceOf(LinkHeaderOverflowError);
        expect(cancelled).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(metadataGet ? 2 : 1);
      }
    }
  });

  test("accepts exactly 1024 members and 64 KiB without dropping later discovery links", async () => {
    const rel = protocol === "solid" ? "describedby" : "linkset";
    const fields = [
      ...Array(1022).fill("<urn:t>; rel=type"),
      `<${ROOT}>; rel=up`,
      `<${NOTE}.meta>; rel=${rel}; title="`,
    ];
    const prefix = fields.join(",");
    const link = `${prefix}${"x".repeat(65536 - prefix.length - 1)}"`;
    const storage = create({
      root: ROOT,
      fetch: async () => new Response(null, { headers: { link } }),
    });
    const result = await storage.head(NOTE);
    expect(result.metadataUrl).toBe(`${NOTE}.meta`);
    expect(result.links.get("type")).toHaveLength(1022);
    expect(result.links.get("up")?.[0]?.target).toBe(ROOT);
  });
});
