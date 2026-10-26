// AUTHORED-BY Codex GPT-6.1-Sol
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { FetchRdfOptions } from "../src/index.js";
import { fetchRdf as implementation, RdfFetchError } from "../src/index.js";
import { JSON_LD_SAMPLE, makeResponse, TURTLE_SAMPLE } from "./helpers.js";

const DEFAULT_ACCEPT = "text/turtle, application/ld+json;q=0.9";

afterEach(() => vi.unstubAllGlobals());

describe.each([
  { name: "default", engine: undefined },
  { name: "Node WASM", engine: createRdfEngine() },
])("fetchRdf ($name)", ({ engine }) => {
  afterAll(() => engine?.dispose());
  const fetchRdf = (url: string, options: FetchRdfOptions = {}) =>
    implementation(url, { ...options, engine });
  it("uses global fetch by default and forwards the abort signal", async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", transport);
    const signal = new AbortController().signal;
    const result = await fetchRdf("https://example.org/empty", { signal });
    expect(result.dataset.size).toBe(0);
    expect(transport.mock.calls[0]?.[1]?.signal).toBe(signal);
  });

  it("wraps non-Error network failures", async () => {
    await expect(
      fetchRdf("https://example.org/failed", {
        fetch: vi.fn<typeof fetch>(async () => {
          throw "network failure";
        }),
      }),
    ).rejects.toMatchObject({ name: "RdfFetchError", cause: "network failure" });
  });

  it("retains status and requested URL when an HTTP failure has no metadata", async () => {
    const response = new Response(null, { status: 503 });
    await expect(
      fetchRdf("https://example.org/failed", { fetch: vi.fn<typeof fetch>(async () => response) }),
    ).rejects.toMatchObject({
      name: "RdfFetchError",
      status: 503,
      url: "https://example.org/failed",
    });
  });

  it("GETs the URL with the canonical Accept header and parses Turtle", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      makeResponse(TURTLE_SAMPLE, {
        contentType: "text/turtle",
        etag: '"abc123"',
        url: "http://example.org/resource",
      }),
    );

    const result = await fetchRdf("http://example.org/resource", {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("accept")).toBe(DEFAULT_ACCEPT);

    expect(result.dataset.size).toBe(5);
    expect(result.etag).toBe(result.headers.get("etag"));
    expect(result.response.headers).toBe(result.headers);
    expect(result.url).toBe("http://example.org/resource");
    expect(result.headers.get("etag")).toBe('"abc123"');
    expect(result.headers.get("content-type")).toBe("text/turtle");
  });

  it("parses JSON-LD when the server returns it", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      makeResponse(JSON_LD_SAMPLE, {
        contentType: "application/ld+json",
        url: "http://example.org/resource",
      }),
    );

    const result = await fetchRdf("http://example.org/resource", {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.dataset.size).toBe(3);
    expect(result.headers.get("content-type")).toBe("application/ld+json");
    expect(result.headers.get("etag")).toBeNull();
    expect(result.etag).toBeNull();
  });

  it("exposes the raw Content-Type on headers (parameters preserved)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      makeResponse(TURTLE_SAMPLE, {
        contentType: "text/turtle; charset=utf-8",
        url: "http://example.org/resource",
      }),
    );

    const result = await fetchRdf("http://example.org/resource", {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.headers.get("content-type")).toBe("text/turtle; charset=utf-8");
    expect(result.contentType).toBe("text/turtle");
    expect(result.dataset.size).toBe(5);
  });

  it("retains the final redirected URL and resolves relative IRIs against it", async () => {
    const response = makeResponse('<#s> <https://example.org/p> "value" .', {
      url: "https://example.org/final",
    });
    const result = await fetchRdf("https://example.org/start", {
      fetch: vi.fn<typeof fetch>(async () => response),
    });
    expect(result.url).toBe("https://example.org/final");
    expect(result.response).toBe(response);
    expect([...result.dataset][0]?.subject.value).toBe("https://example.org/final#s");
  });

  it("falls back to the requested URL and preserves absent metadata as null", async () => {
    const result = await fetchRdf("https://example.org/requested", {
      fetch: vi.fn<typeof fetch>(async () => makeResponse("", { omitContentType: true })),
    });
    expect(result.url).toBe("https://example.org/requested");
    expect(result.etag).toBeNull();
    expect(result.contentType).toBeNull();
  });

  it("overrides any caller-supplied accept in `headers`", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      makeResponse(TURTLE_SAMPLE, { contentType: "text/turtle" }),
    );

    await fetchRdf("http://example.org/resource", {
      fetch: fetchMock as unknown as typeof fetch,
      headers: { accept: "text/html" },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("accept")).toBe(DEFAULT_ACCEPT);
  });

  it("wraps a network error in RdfFetchError", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("connection refused");
    });

    await expect(
      fetchRdf("http://example.org/resource", {
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: "RdfFetchError",
      url: "http://example.org/resource",
    });
  });

  it("throws RdfFetchError with status on a 404", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      makeResponse("not found", {
        status: 404,
        contentType: "text/plain",
        url: "http://example.org/missing",
      }),
    );

    const err = await fetchRdf("http://example.org/missing", {
      fetch: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RdfFetchError);
    expect(err).toMatchObject({
      status: 404,
      url: "http://example.org/missing",
      contentType: "text/plain",
    });
  });

  it("throws RdfFetchError with status on a 500", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      makeResponse("boom", { status: 500, url: "http://example.org/r" }),
    );

    const err = await fetchRdf("http://example.org/r", {
      fetch: fetchMock as unknown as typeof fetch,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RdfFetchError);
    expect((err as RdfFetchError).status).toBe(500);
  });

  it("treats a missing Content-Type header as Turtle", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      makeResponse(TURTLE_SAMPLE, {
        omitContentType: true,
        url: "http://example.org/r",
      }),
    );

    const result = await fetchRdf("http://example.org/r", {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.dataset.size).toBe(5);
    expect(result.headers.get("content-type")).toBeNull();
  });

  it("throws RdfFetchError on an unsupported response Content-Type", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      makeResponse("<html/>", {
        contentType: "text/html",
        url: "http://example.org/r",
      }),
    );

    await expect(
      fetchRdf("http://example.org/r", {
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(RdfFetchError);
  });
});
