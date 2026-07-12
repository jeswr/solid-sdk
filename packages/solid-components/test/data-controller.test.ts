// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it, vi } from "vitest";
import { DataController } from "../src/data-controller.js";
import { AccessDeniedError, DataFormatError, NetworkError, NotFoundError } from "../src/errors.js";

const TURTLE = "text/turtle";

/** Build a Response-like object the DataController reads (jsdom Response is fine). */
function res(
  body: string,
  init?: { status?: number; contentType?: string; etag?: string },
): Response {
  const status = init?.status ?? 200;
  const headers = new Headers();
  headers.set("Content-Type", init?.contentType ?? TURTLE);
  if (init?.etag) headers.set("ETag", init.etag);
  // The WHATWG Response constructor forbids a body for null-body statuses (304),
  // so synthesise a minimal Response-shaped object for those (the DataController
  // only reads .status / .ok / .headers / .body / .text()).
  if (status === 304 || status === 204) {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers,
      body: null,
      text: async () => "",
    } as unknown as Response;
  }
  return new Response(body, { status, headers });
}

/** A vi.fn typed with the (url, init) signature so `.mock.calls[i]` destructures. */
function mockFetch(impl: () => Promise<Response>) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(impl);
}

/**
 * A Response-shaped object whose `.url` is the FINAL (post-redirect) URL — the
 * WHATWG `Response` constructor does not let you set `.url`, so we synthesise the
 * minimal surface the DataController reads.
 */
function redirectedRes(finalUrl: string, body: string, contentType = TURTLE): Response {
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  return {
    status: 200,
    ok: true,
    url: finalUrl,
    headers,
    body: null,
    text: async () => body,
  } as unknown as Response;
}

const PROFILE = `
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<https://alice.example/me> a foaf:Person ; foaf:name "Alice" .
`;

const CONTAINER = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://alice.example/c/>
  a ldp:Container, ldp:BasicContainer ;
  ldp:contains <https://alice.example/c/a.ttl>, <https://alice.example/c/sub/> .
<https://alice.example/c/sub/> a ldp:Container .
`;

describe("DataController.read", () => {
  it("reads + parses RDF into a Store with the resource quads", async () => {
    const fetch = vi.fn(async () => res(PROFILE));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await dc.read("https://alice.example/me");
    expect(result.notModified).toBe(false);
    const dataset = result.dataset;
    if (!dataset) throw new Error("expected a dataset");
    const names = dataset.getObjects(
      "https://alice.example/me",
      "http://xmlns.com/foaf/0.1/name",
      null,
    );
    expect(names.map((n) => n.value)).toContain("Alice");
  });

  it("sends Accept: turtle + json-ld and the GET method", async () => {
    const fetch = mockFetch(async () => res(PROFILE));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    await dc.read("https://alice.example/me");
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Accept).toContain("text/turtle");
    expect((init.headers as Record<string, string>).Accept).toContain("application/ld+json");
  });

  it("returns the ETag and re-sends it as If-None-Match", async () => {
    const fetch = mockFetch(async () => res(PROFILE, { etag: '"v1"' }));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    const first = await dc.read("https://alice.example/me");
    expect(first.etag).toBe('"v1"');

    await dc.read("https://alice.example/me", { etag: '"v1"' });
    const init = fetch.mock.calls[1][1] as RequestInit;
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe('"v1"');
  });

  it("a 304 short-circuits with notModified + no dataset", async () => {
    const fetch = vi.fn(async () => res("", { status: 304, etag: '"v1"' }));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await dc.read("https://alice.example/me", { etag: '"v1"' });
    expect(result.notModified).toBe(true);
    expect(result.dataset).toBeUndefined();
    expect(result.etag).toBe('"v1"');
  });

  it("classifies 404 → NotFoundError", async () => {
    const fetch = vi.fn(async () => res("", { status: 404 }));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(dc.read("https://alice.example/missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("classifies 403 → AccessDeniedError", async () => {
    const fetch = vi.fn(async () => res("", { status: 403 }));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(dc.read("https://alice.example/secret")).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("classifies 500 → NetworkError", async () => {
    const fetch = vi.fn(async () => res("", { status: 500 }));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(dc.read("https://alice.example/x")).rejects.toBeInstanceOf(NetworkError);
  });

  it("classifies a transport failure → NetworkError", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(dc.read("https://alice.example/x")).rejects.toBeInstanceOf(NetworkError);
  });

  it("classifies a 2xx body that will not parse → DataFormatError", async () => {
    const fetch = vi.fn(async () => res("this is <<< not turtle"));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(dc.read("https://alice.example/bad")).rejects.toBeInstanceOf(DataFormatError);
  });

  it("uses publicFetch when { public: true }, the auth fetch otherwise", async () => {
    const authFetch = vi.fn(async () => res(PROFILE));
    const publicFetch = vi.fn(async () => res(PROFILE));
    const dc = new DataController({
      fetch: authFetch as unknown as typeof globalThis.fetch,
      publicFetch: publicFetch as unknown as typeof globalThis.fetch,
    });

    await dc.read("https://alice.example/me");
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(publicFetch).not.toHaveBeenCalled();

    await dc.read("https://foreign.example/data", { public: true });
    expect(publicFetch).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledTimes(1); // unchanged — auth never used a foreign read.
  });

  it("a public read FAILS CLOSED (no auth fetch, no global) when publicFetch is omitted", async () => {
    // Security, fail-closed: when publicFetch is not injected, a { public: true }
    // read must THROW — never the authenticated fetch, never a (possibly
    // auth-patched) global fetch — so the session token can't leak to a foreign URL.
    const authFetch = vi.fn(async () => res(PROFILE));
    const globalSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => res(PROFILE) as unknown as Response);
    try {
      const dc = new DataController({ fetch: authFetch as unknown as typeof globalThis.fetch });
      await expect(
        dc.read("https://foreign.example/data", { public: true }),
      ).rejects.toBeInstanceOf(NetworkError);
      // NEITHER the auth fetch NOR the global fetch was used.
      expect(authFetch).not.toHaveBeenCalled();
      expect(globalSpy).not.toHaveBeenCalled();
    } finally {
      globalSpy.mockRestore();
    }
  });

  it("resolves relative IRIs + result.url against the FINAL URL after a redirect", async () => {
    // The body uses a relative IRI <#me> + relative <photo.jpg>; the request was to
    // `/profile` but the server redirected to `/profile/card`. Both must resolve
    // against the FINAL url, not the requested one. (Redirect baseIRI regression.)
    const body = `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <#me> a foaf:Person ; foaf:img <photo.jpg> .
    `;
    const fetch = vi.fn(async () => redirectedRes("https://alice.example/profile/card", body));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    const result = await dc.read("https://alice.example/profile");

    expect(result.url).toBe("https://alice.example/profile/card");
    const dataset = result.dataset;
    if (!dataset) throw new Error("expected a dataset");
    // <#me> resolves against the FINAL url → .../card#me, and <photo.jpg> →
    // .../profile/photo.jpg — both relative to the redirect target, not /profile.
    const imgs = dataset.getObjects(
      "https://alice.example/profile/card#me",
      "http://xmlns.com/foaf/0.1/img",
      null,
    );
    expect(imgs.map((o) => o.value)).toContain("https://alice.example/profile/photo.jpg");
  });
});

describe("DataController.listContainer", () => {
  it("lists ldp:contains children with isContainer derived from type/slash", async () => {
    const fetch = vi.fn(async () => res(CONTAINER));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    const listing = await dc.listContainer("https://alice.example/c/");
    const byUrl = new Map(listing.children.map((c) => [c.url, c]));
    expect(byUrl.has("https://alice.example/c/a.ttl")).toBe(true);
    expect(byUrl.has("https://alice.example/c/sub/")).toBe(true);
    expect(byUrl.get("https://alice.example/c/a.ttl")?.isContainer).toBe(false);
    expect(byUrl.get("https://alice.example/c/sub/")?.isContainer).toBe(true);
  });

  it("only lists children of THIS container (subject match)", async () => {
    const mixed = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <https://alice.example/c/> ldp:contains <https://alice.example/c/keep> .
      <https://other.example/d/> ldp:contains <https://alice.example/c/SHOULD_NOT_APPEAR> .
    `;
    const fetch = vi.fn(async () => res(mixed));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    const listing = await dc.listContainer("https://alice.example/c/");
    expect(listing.children.map((c) => c.url)).toEqual(["https://alice.example/c/keep"]);
  });

  it("de-duplicates children by URL", async () => {
    const dup = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <https://alice.example/c/> ldp:contains <https://alice.example/c/x>, <https://alice.example/c/x> .
    `;
    const fetch = vi.fn(async () => res(dup));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    const listing = await dc.listContainer("https://alice.example/c/");
    expect(listing.children).toHaveLength(1);
  });

  it("matches children against the FINAL URL after a trailing-slash redirect", async () => {
    // `…/c` redirects to `…/c/`; the container body's relative subject `<>` + the
    // relative child resolve against the FINAL url, and the listing must enumerate
    // them (not come back empty because it matched the requested URL). Regression.
    const body = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <> a ldp:Container ; ldp:contains <a.ttl>, <sub/> .
    `;
    const fetch = vi.fn(async () => redirectedRes("https://alice.example/c/", body));
    const dc = new DataController({ fetch: fetch as unknown as typeof globalThis.fetch });
    const listing = await dc.listContainer("https://alice.example/c");

    expect(listing.url).toBe("https://alice.example/c/");
    expect(listing.children.map((c) => c.url).sort()).toEqual([
      "https://alice.example/c/a.ttl",
      "https://alice.example/c/sub/",
    ]);
  });
});
