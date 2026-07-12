// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthDocument } from "../src/model.js";
import { emptyHealthDocument, RdfFetchError, readHealth, writeHealth } from "../src/store.js";
import { CONFORMANT_HEALTH_TTL } from "./fixtures.js";

/** Build a Response that @jeswr/fetch-rdf accepts as a Turtle RDF resource. */
function turtleResponse(ttl: string, init: ResponseInit & { etag?: string } = {}): Response {
  const headers = new Headers({ "content-type": "text/turtle" });
  if (init.etag) headers.set("etag", init.etag);
  return new Response(ttl, { status: init.status ?? 200, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("emptyHealthDocument", () => {
  it("returns a fresh, empty HealthDocument", () => {
    const doc = emptyHealthDocument();
    expect(doc).toBeInstanceOf(HealthDocument);
    expect([...doc.records]).toHaveLength(0);
    expect(doc.size).toBe(0);
  });
});

describe("readHealth", () => {
  it("reads a resource into a typed document and surfaces the etag + url", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(turtleResponse(CONFORMANT_HEALTH_TTL, { etag: '"abc"' }));

    const { document, etag, url } = await readHealth("https://carol.example/health/record.ttl", {
      fetch: fetchMock,
    });

    expect(etag).toBe('"abc"');
    expect(url).toBe("https://carol.example/health/record.ttl");
    expect([...document.records]).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("propagates the abort signal to the underlying fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(turtleResponse(CONFORMANT_HEALTH_TTL));
    await readHealth("https://carol.example/health/record.ttl", {
      fetch: fetchMock,
      signal: controller.signal,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  it("throws RdfFetchError with .status on a 403 (WAC-gated read)", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await expect(
      readHealth("https://carol.example/health/record.ttl", { fetch: fetchMock }),
    ).rejects.toMatchObject({ status: 403 });
    // The error is the typed RdfFetchError, not a bare Error.
    const err = await readHealth("https://carol.example/health/record.ttl", {
      fetch: fetchMock,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(RdfFetchError);
  });

  it("throws RdfFetchError with .status on a 404 (absent resource)", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Not found", { status: 404 }));
    await expect(
      readHealth("https://carol.example/health/missing.ttl", { fetch: fetchMock }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("falls back to the patched globalThis.fetch when no fetch is supplied", async () => {
    const globalMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(turtleResponse(CONFORMANT_HEALTH_TTL, { etag: '"g"' }));
    const { etag } = await readHealth("https://carol.example/health/record.ttl");
    expect(etag).toBe('"g"');
    expect(globalMock).toHaveBeenCalledOnce();
  });
});

describe("writeHealth", () => {
  it("PUTs serialised Turtle with the conditional If-Match header", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 205 }));
    const doc = emptyHealthDocument();
    const obs = doc.mintObservation("urn:o", "HeartRate");
    obs.measuredValue = 60;

    const res = await writeHealth("https://carol.example/health/record.ttl", doc, {
      fetch: fetchMock,
      etag: '"abc"',
    });

    expect(res.status).toBe(205);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("text/turtle");
    expect(headers["if-match"]).toBe('"abc"');
    expect(String(init.body)).toContain("health:");
  });

  it("omits If-Match when no etag is given (unconditional write)", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    await writeHealth("https://carol.example/health/record.ttl", emptyHealthDocument(), {
      fetch: fetchMock,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["if-match"]).toBeUndefined();
  });

  it("omits If-Match when the etag is null", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    await writeHealth("https://carol.example/health/record.ttl", emptyHealthDocument(), {
      fetch: fetchMock,
      etag: null,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["if-match"]).toBeUndefined();
  });

  it("passes the abort signal through to the PUT", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    await writeHealth("https://carol.example/health/record.ttl", emptyHealthDocument(), {
      fetch: fetchMock,
      signal: controller.signal,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("falls back to globalThis.fetch when no fetch is supplied", async () => {
    const globalMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));
    await writeHealth("https://carol.example/health/record.ttl", emptyHealthDocument());
    expect(globalMock).toHaveBeenCalledOnce();
  });
});
