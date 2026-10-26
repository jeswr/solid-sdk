// AUTHORED-BY Codex GPT-6.1-Sol
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createIndexedDbCache, createMemoryCache } from "./cache.js";
import { parseLwsDescription } from "./lws-description.js";
import { resolveStorageDescription } from "./resolve.js";
import { sparqLwsCid } from "./testing.js";
import type { ResolveOptions, StorageDescription } from "./types.js";
import { NOTIFY, PIM, SOLID, SSD } from "./vocab.js";

const RESOURCE = "https://pod.example/alice/deep/file?query=1";
const ROOT = "https://pod.example/alice/";
const DESCRIPTION = "https://pod.example/.well-known/solid";
const LWS_RESOURCE = "https://lws.example/data/file";
const LWS_LINK = `<${sparqLwsCid.id}>; rel="https://www.w3.org/ns/lws#storage"`;
const SOLID_LINK = `<${DESCRIPTION}>; rel="${SOLID.storageDescription}"`;
const ROOT_LINK = `<${PIM.Storage}>; rel="type"`;
const TURTLE = `
  @prefix notify: <http://www.w3.org/ns/solid/notifications#> .
  <${DESCRIPTION}> notify:subscription <https://pod.example/notifications/ws> .
  <https://pod.example/notifications/ws> notify:channelType notify:WebSocketChannel2023 .
`;

function setup() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const options: ResolveOptions = { fetch, cache: createMemoryCache(), now: () => 1000 };
  return { fetch, options };
}

function head(link = "", status = 200) {
  return new Response(null, { status, headers: { Link: link } });
}

function cid(headers: HeadersInit = {}, body: unknown = sparqLwsCid) {
  return new Response(JSON.stringify(body), { headers });
}

function rdf(body = TURTLE, headers: HeadersInit = {}) {
  return new Response(body, { headers: { "Content-Type": "text/turtle", ...headers } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveStorageDescription discovery", () => {
  test.each([
    200, 401, 403,
  ])("resolves LWS from HEAD %i and caches sibling resources", async (status) => {
    const { fetch, options } = setup();
    const signal = new AbortController().signal;
    options.signal = signal;
    fetch
      .mockResolvedValueOnce(head(`${LWS_LINK}, ${SOLID_LINK}`, status))
      .mockResolvedValueOnce(cid({ ETag: '"v1"', "Cache-Control": "public, max-age=60" }));
    const description = await resolveStorageDescription(`${LWS_RESOURCE}#fragment`, options);
    expect(description).toMatchObject({
      protocol: "lws",
      id: sparqLwsCid.id,
      root: "https://lws.example/",
      sources: ["lws-cid"],
      fetchedAt: 1000,
      etag: '"v1"',
      maxAgeMs: 60_000,
    });
    expect(description.services).toContainEqual(
      expect.objectContaining({ type: ["https://www.w3.org/ns/lws#StorageRoot"] }),
    );
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [LWS_RESOURCE, "HEAD"],
      [sparqLwsCid.id, "GET"],
    ]);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("accept")).toBe(
      "application/lws+cid, application/cid;q=0.9, application/ld+json;q=0.8",
    );
    expect(
      fetch.mock.calls.every(([, init]) => init?.redirect === "manual" && init.signal === signal),
    ).toBe(true);
    fetch.mockClear();
    expect(await resolveStorageDescription("https://lws.example/sibling", options)).toEqual(
      description,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test("walks Solid ancestors with exactly three HEADs, then fetches Turtle", async () => {
    const { fetch, options } = setup();
    fetch
      .mockResolvedValueOnce(head(SOLID_LINK))
      .mockResolvedValueOnce(head())
      .mockResolvedValueOnce(head(ROOT_LINK))
      .mockResolvedValueOnce(rdf());
    const description = await resolveStorageDescription(RESOURCE, options);
    expect(description).toMatchObject({
      protocol: "solid",
      id: ROOT,
      root: ROOT,
      descriptionUrl: DESCRIPTION,
      sources: ["solid-description"],
      fetchedAt: 1000,
      etag: null,
      maxAgeMs: 3_600_000,
    });
    expect(description.services).toMatchObject([
      { type: [SSD.SolidNotificationService, NOTIFY.WebSocketChannel2023] },
    ]);
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [RESOURCE, "HEAD"],
      ["https://pod.example/alice/deep/", "HEAD"],
      [ROOT, "HEAD"],
      [DESCRIPTION, "GET"],
    ]);
    expect(new Headers(fetch.mock.calls[3]?.[1]?.headers).get("accept")).toBe(
      "application/ld+json, text/turtle;q=0.9",
    );
    fetch.mockClear();
    expect(await resolveStorageDescription(`${ROOT}sibling`, options)).toEqual(description);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("uses seed headers and root typing without HEAD", async () => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: `${SOLID_LINK}, ${ROOT_LINK}` });
    fetch.mockResolvedValueOnce(rdf(""));
    expect(await resolveStorageDescription(`${ROOT}?ignored=1`, options)).toMatchObject({
      root: ROOT,
      services: [],
      capabilities: [],
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("uses the memory default across calls", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(cid());
    const opts = { fetch, now: () => 0, seedHeaders: new Headers({ Link: LWS_LINK }) };
    const first = await resolveStorageDescription(LWS_RESOURCE, opts);
    expect(await resolveStorageDescription(LWS_RESOURCE, opts)).toEqual(first);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test.each([
    0, 1, 8,
  ])("bounds the ancestor walk at %i and records an assumed origin root", async (limit) => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: SOLID_LINK });
    options.maxAncestorProbes = limit;
    fetch.mockImplementation(async (_url, init) => (init?.method === "HEAD" ? head() : rdf("")));
    const description = await resolveStorageDescription(RESOURCE, options);
    expect(description).toMatchObject({
      root: "https://pod.example/",
      evidence: ["assumed-origin-root"],
    });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "HEAD")).toHaveLength(
      Math.min(limit, 3),
    );
  });

  test("stops at the origin for a root URL, and uses the default eight-probe bound", async () => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: SOLID_LINK });
    fetch.mockImplementation(async (_url, init) => (init?.method === "HEAD" ? head() : rdf("")));
    await resolveStorageDescription("https://pod.example/", options);
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockClear();
    options.cache = createMemoryCache();
    await resolveStorageDescription(`https://pod.example/${"a/".repeat(12)}file`, options);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "HEAD")).toHaveLength(8);
  });

  test.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects an invalid ancestor limit %s", async (limit) => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: SOLID_LINK });
    options.maxAncestorProbes = limit;
    await expect(resolveStorageDescription(RESOURCE, options)).rejects.toMatchObject({
      code: "description-invalid",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("reads CSS JSON-LD with the bundled context and no context fetch", async () => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: `${SOLID_LINK}, ${ROOT_LINK}` });
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          "@context": ["https://www.w3.org/ns/solid/notifications-context/v1"],
          id: DESCRIPTION,
          subscription: [
            { id: "/ws", channelType: "WebSocketChannel2023", feature: ["accept", "state"] },
          ],
        }),
        { headers: { "Content-Type": "application/ld+json" } },
      ),
    );
    const description = await resolveStorageDescription(ROOT, options);
    expect(description.services).toEqual([
      {
        type: [SSD.SolidNotificationService, NOTIFY.WebSocketChannel2023],
        endpoint: "https://pod.example/ws",
        extra: {
          [NOTIFY.channelType]: NOTIFY.WebSocketChannel2023,
          [NOTIFY.feature]: [
            "http://www.w3.org/ns/solid/notifications#accept",
            "http://www.w3.org/ns/solid/notifications#state",
          ],
        },
      },
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("accepts the legacy notification context alias", async () => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: `${SOLID_LINK}, ${ROOT_LINK}` });
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          "@context": "https://www.w3.org/ns/solid/notification/v1",
          id: DESCRIPTION,
        }),
        {
          headers: { "Content-Type": "application/ld+json" },
        },
      ),
    );
    expect(await resolveStorageDescription(ROOT, options)).toMatchObject({ services: [] });
  });

  test("resolves NSS Updates-Via through ancestor walking without GET", async () => {
    const { fetch, options } = setup();
    fetch
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { "Updates-Via": "wss://pod.example/socket", "Cache-Control": "max-age=10" },
        }),
      )
      .mockResolvedValueOnce(head())
      .mockResolvedValueOnce(head(ROOT_LINK));
    expect(await resolveStorageDescription(RESOURCE, options)).toMatchObject({
      protocol: "solid",
      root: ROOT,
      descriptionUrl: null,
      sources: ["probe"],
      maxAgeMs: 10_000,
      services: [
        {
          type: [SSD.SolidNotificationService, SSD.LegacyUpdatesVia],
          endpoint: "wss://pod.example/socket",
        },
      ],
    });
    expect(fetch.mock.calls.every(([, init]) => init?.method === "HEAD")).toBe(true);
  });

  test.each([
    "updates-via",
    "http://www.w3.org/ns/solid/terms#updatesVia",
  ])("supports legacy Link relation %s", async (rel) => {
    const { options } = setup();
    options.seedHeaders = new Headers({
      Link: `<wss://pod.example/ws>; rel="${rel}", ${ROOT_LINK}`,
    });
    expect(await resolveStorageDescription(ROOT, options)).toMatchObject({
      services: [{ endpoint: "wss://pod.example/ws" }],
    });
  });

  test("reports no-storage-link and ignores discovery links anchored to another resource", async () => {
    const { fetch, options } = setup();
    fetch.mockResolvedValueOnce(head(`${LWS_LINK}; anchor="/other"`));
    await expect(resolveStorageDescription(RESOURCE, options)).rejects.toMatchObject({
      code: "no-storage-link",
      url: RESOURCE,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("refresh", () => {
  test.each([
    "memory",
    "IndexedDB",
  ])("%s: TTL expiry makes one conditional GET, 304 refreshes metadata and retains probe", async (kind) => {
    const { fetch, options } = setup();
    if (kind === "IndexedDB") {
      vi.stubGlobal("indexedDB", new IDBFactory());
      options.cache = createIndexedDbCache();
    }
    options.seedHeaders = new Headers({ Link: LWS_LINK });
    fetch.mockResolvedValueOnce(cid({ ETag: '"v1"', "Cache-Control": "max-age=1" }));
    const first = await resolveStorageDescription(LWS_RESOURCE, options);
    const cachedProbe = { url: first.root, observedAt: 10, evidence: [] };
    await options.cache?.set(first.id, { description: first, probe: cachedProbe });
    fetch.mockClear();
    options.now = () => 1999;
    expect(await resolveStorageDescription(LWS_RESOURCE, options)).toEqual(first);
    expect(fetch).not.toHaveBeenCalled();
    options.now = () => 2000;
    fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 304,
        headers: { "Cache-Control": 'max-age="2"', ETag: '"v2"' },
      }),
    );
    const refreshed = await resolveStorageDescription(LWS_RESOURCE, options);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(sparqLwsCid.id);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("if-none-match")).toBe('"v1"');
    expect(refreshed).toEqual({ ...first, fetchedAt: 2000, maxAgeMs: 2000, etag: '"v2"' });
    expect(await options.cache?.get(first.id)).toEqual({
      description: refreshed,
      probe: cachedProbe,
    });
    fetch.mockClear();
    expect(await resolveStorageDescription(LWS_RESOURCE, options)).toEqual(refreshed);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("304 without cache headers retains TTL and ETag; a 200 replaces them and drops old probe", async () => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: LWS_LINK });
    fetch.mockResolvedValueOnce(cid({ ETag: '"v1"', "Cache-Control": "max-age=1" }));
    const first = await resolveStorageDescription(LWS_RESOURCE, options);
    await options.cache?.set(first.id, {
      description: first,
      probe: { url: first.root, observedAt: 0, evidence: [] },
    });
    options.now = () => 2000;
    fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
    expect(await resolveStorageDescription(LWS_RESOURCE, options)).toMatchObject({
      maxAgeMs: 1000,
      etag: '"v1"',
      fetchedAt: 2000,
    });
    options.now = () => 3000;
    fetch.mockResolvedValueOnce(cid());
    const next = await resolveStorageDescription(LWS_RESOURCE, options);
    expect(next).toMatchObject({ maxAgeMs: 3_600_000, etag: null, fetchedAt: 3000 });
    expect(await options.cache?.get(next.id)).toEqual({ description: next });
  });

  test("refreshes Solid RDF without HEAD and sends no conditional header when there is no ETag", async () => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: `${SOLID_LINK}, ${ROOT_LINK}` });
    fetch.mockResolvedValueOnce(rdf("", { "Cache-Control": "max-age=0" }));
    await resolveStorageDescription(ROOT, options);
    fetch.mockClear().mockResolvedValueOnce(rdf());
    expect(await resolveStorageDescription(`${ROOT}sibling`, options)).toMatchObject({
      services: [{ endpoint: "https://pod.example/notifications/ws" }],
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has("if-none-match")).toBe(false);
  });

  test("an expired legacy record repeats discovery and explicit deletion invalidates a hit", async () => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({
      "Updates-Via": "wss://pod.example/ws",
      Link: ROOT_LINK,
      "Cache-Control": "max-age=0",
    });
    await resolveStorageDescription(ROOT, options);
    options.seedHeaders = undefined;
    fetch.mockResolvedValueOnce(
      new Response(null, { headers: { "Updates-Via": "wss://pod.example/new", Link: ROOT_LINK } }),
    );
    const next = await resolveStorageDescription(ROOT, options);
    expect(next.services[0]?.endpoint).toBe("wss://pod.example/new");
    expect(fetch).toHaveBeenCalledOnce();
    await options.cache?.delete(next.id);
    fetch.mockResolvedValueOnce(head());
    await expect(resolveStorageDescription(ROOT, options)).rejects.toMatchObject({
      code: "no-storage-link",
    });
  });

  test.each([404, 410])("invalidates the description after refresh %i", async (status) => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: LWS_LINK });
    fetch.mockResolvedValueOnce(cid({ "Cache-Control": "max-age=0" }));
    const first = await resolveStorageDescription(LWS_RESOURCE, options);
    fetch.mockResolvedValueOnce(new Response("missing", { status }));
    await expect(resolveStorageDescription(LWS_RESOURCE, options)).rejects.toMatchObject({
      code: "description-unreachable",
      status,
    });
    expect(await options.cache?.get(first.id)).toBeUndefined();
  });

  test("invalidates on a changed foreign root but keeps cached metadata on temporary failures", async () => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: LWS_LINK });
    fetch.mockResolvedValueOnce(cid({ "Cache-Control": "max-age=0" }));
    const first = await resolveStorageDescription(LWS_RESOURCE, options);
    fetch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(resolveStorageDescription(LWS_RESOURCE, options)).rejects.toMatchObject({
      code: "network",
    });
    expect(await options.cache?.get(first.id)).toEqual({ description: first });
    fetch.mockResolvedValueOnce(
      cid(
        {},
        {
          ...sparqLwsCid,
          service: [{ type: "StorageRoot", serviceEndpoint: "https://evil.example/" }],
        },
      ),
    );
    await expect(resolveStorageDescription(LWS_RESOURCE, options)).rejects.toMatchObject({
      code: "root-mismatch",
    });
    expect(await options.cache?.get(first.id)).toBeUndefined();
  });
});

describe("validation and failures", () => {
  test.each([
    "not a URL",
    "file:///tmp/file",
    "https://user:password@pod.example/",
  ])("rejects invalid destination %s", async (url) => {
    const { fetch, options } = setup();
    await expect(resolveStorageDescription(url, options)).rejects.toMatchObject({
      code: "description-invalid",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    "https://evil.example/cid",
    "http://lws.example/cid",
    "https://lws.example:444/cid",
  ])("refuses foreign LWS description %s before GET", async (target) => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({
      Link: `<${target}>; rel="https://www.w3.org/ns/lws#storage"`,
    });
    await expect(resolveStorageDescription(LWS_RESOURCE, options)).rejects.toMatchObject({
      code: "root-mismatch",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("foreign Solid description contributes only notify entries, even when a generic service spoofs their type", async () => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({
      Link: `<https://other.example/description>; rel="${SOLID.storageDescription}", ${ROOT_LINK}`,
    });
    fetch.mockResolvedValueOnce(
      rdf(
        TURTLE +
          `
      <${ROOT}> <https://www.w3.org/ns/did#service> [ a <${SSD.SolidNotificationService}> ; <https://www.w3.org/ns/did#serviceEndpoint> <https://evil.example/> ] ;
        <https://www.w3.org/ns/lws#capability> [ a <${SSD.RecursiveDelete}> ] ;
        <http://www.w3.org/ns/solid/sparql#endpoint> <https://evil.example/sparql> .
    `,
      ),
    );
    const description = await resolveStorageDescription(ROOT, options);
    expect(description).toMatchObject({ capabilities: [], evidence: ["cross-origin-description"] });
    expect(description.services).toHaveLength(1);
    expect(description.services[0]?.endpoint).toBe("https://pod.example/notifications/ws");
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBe("omit");
    options.now = () => description.fetchedAt + description.maxAgeMs;
    fetch.mockResolvedValueOnce(rdf());
    expect(await resolveStorageDescription(ROOT, options)).toMatchObject({
      evidence: ["cross-origin-description"],
    });
  });

  test("invalidates a newly discovered storage even when no prefix matched it", async () => {
    const { fetch, options } = setup();
    const previous = parseLwsDescription(sparqLwsCid, sparqLwsCid.id, LWS_RESOURCE);
    await options.cache?.set(previous.id, { description: previous });
    options.seedHeaders = new Headers({ Link: LWS_LINK });
    fetch.mockResolvedValueOnce(
      cid(
        {},
        {
          ...sparqLwsCid,
          service: [{ type: "StorageRoot", serviceEndpoint: "https://evil.example/" }],
        },
      ),
    );
    await expect(resolveStorageDescription(LWS_RESOURCE, options)).rejects.toMatchObject({
      code: "root-mismatch",
    });
    expect(await options.cache?.get(previous.id)).toBeUndefined();
  });

  test("rejects a cached LWS description with a foreign description URL before using it", async () => {
    const { fetch, options } = setup();
    const description = {
      ...parseLwsDescription(sparqLwsCid, sparqLwsCid.id, LWS_RESOURCE),
      descriptionUrl: "https://evil.example/cid",
    };
    await options.cache?.set(description.id, { description });
    await options.cache?.rememberPrefix(description.root, description.id);
    await expect(resolveStorageDescription(LWS_RESOURCE, options)).rejects.toMatchObject({
      code: "root-mismatch",
    });
    expect(await options.cache?.get(description.id)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("rejects and removes a cached foreign root", async () => {
    const { fetch, options } = setup();
    const description: StorageDescription = {
      ...parseLwsDescription(sparqLwsCid, sparqLwsCid.id, LWS_RESOURCE),
      root: "https://evil.example/",
    };
    await options.cache?.set(description.id, { description });
    await options.cache?.rememberPrefix("https://lws.example/", description.id);
    await expect(resolveStorageDescription(LWS_RESOURCE, options)).rejects.toMatchObject({
      code: "root-mismatch",
    });
    expect(await options.cache?.get(description.id)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    "https://pod.example/socket",
    "wss://user:pass@pod.example/socket",
    "wss://[",
  ])("rejects invalid Updates-Via %s", async (endpoint) => {
    const { options } = setup();
    options.seedHeaders = new Headers({ "Updates-Via": endpoint, Link: ROOT_LINK });
    await expect(resolveStorageDescription(ROOT, options)).rejects.toMatchObject({
      code: "description-invalid",
    });
  });

  test.each([302, 307, 308, 0])("refuses redirects and opaque responses (%i)", async (status) => {
    const { fetch, options } = setup();
    fetch.mockResolvedValueOnce(status ? new Response(null, { status }) : Response.error());
    await expect(resolveStorageDescription(RESOURCE, options)).rejects.toMatchObject({
      code: "description-unreachable",
      status,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("refuses an already followed redirect", async () => {
    const { fetch, options } = setup();
    const response = head();
    Object.defineProperty(response, "redirected", { value: true });
    fetch.mockResolvedValueOnce(response);
    await expect(resolveStorageDescription(RESOURCE, options)).rejects.toMatchObject({
      code: "description-unreachable",
    });
  });

  test("wraps network failures on initial discovery and ancestor HEAD", async () => {
    const { fetch, options } = setup();
    fetch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(resolveStorageDescription(RESOURCE, options)).rejects.toMatchObject({
      code: "network",
      url: RESOURCE,
    });
    options.seedHeaders = new Headers({ Link: SOLID_LINK });
    fetch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(resolveStorageDescription(RESOURCE, options)).rejects.toMatchObject({
      code: "network",
      url: "https://pod.example/alice/deep/",
    });
  });

  test.each([304, 404, 500])("reports initial description HTTP %i", async (status) => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: LWS_LINK });
    fetch.mockResolvedValueOnce(new Response(null, { status }));
    await expect(resolveStorageDescription(LWS_RESOURCE, options)).rejects.toMatchObject({
      code: "description-unreachable",
      status,
    });
  });

  test.each(["{broken", "null", ""])("reports malformed CID %s", async (body) => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: LWS_LINK });
    fetch.mockResolvedValueOnce(body ? new Response(body) : new Response(null));
    await expect(resolveStorageDescription(LWS_RESOURCE, options)).rejects.toMatchObject({
      code: "description-invalid",
    });
  });

  test("reports malformed RDF and refuses arbitrary remote contexts without fetching them", async () => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: `${SOLID_LINK}, ${ROOT_LINK}` });
    fetch.mockResolvedValueOnce(rdf("broken Turtle"));
    await expect(resolveStorageDescription(ROOT, options)).rejects.toMatchObject({
      code: "description-invalid",
    });
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ "@context": "https://evil.example/context", id: ROOT }), {
        headers: { "Content-Type": "application/ld+json" },
      }),
    );
    await expect(resolveStorageDescription(ROOT, options)).rejects.toMatchObject({
      code: "description-invalid",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    "max-age=invalid",
    "max-age=-1",
    'max-age="1',
    'max-age=1"',
    `max-age=${"9".repeat(30)}`,
  ])("defaults invalid TTL %s", async (value) => {
    const { fetch, options } = setup();
    options.seedHeaders = new Headers({ Link: LWS_LINK });
    fetch.mockResolvedValueOnce(cid({ "Cache-Control": value }));
    expect(await resolveStorageDescription(LWS_RESOURCE, options)).toMatchObject({
      maxAgeMs: 3_600_000,
    });
  });

  test("uses the real clock when no clock is injected", async () => {
    const { fetch, options } = setup();
    options.now = undefined;
    options.seedHeaders = new Headers({ Link: LWS_LINK });
    fetch.mockResolvedValueOnce(cid({ "Cache-Control": "max-age=0" }));
    const first = await resolveStorageDescription(LWS_RESOURCE, options);
    expect(first.fetchedAt).toBeGreaterThan(0);
    fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
    const next = await resolveStorageDescription(LWS_RESOURCE, options);
    expect(next.fetchedAt).toBeGreaterThanOrEqual(first.fetchedAt);
  });
});
