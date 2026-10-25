// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchDocumentLoader, fetchRdf, parseRdf, RdfFetchError } from "../src/index.js";

const contextUrl = "https://contexts.example/name";
const context = { "@context": { name: "https://schema.org/name" } };
const body = JSON.stringify({
  "@context": contextUrl,
  "@id": "https://example.org/alice",
  name: "Alice",
});

afterEach(() => vi.unstubAllGlobals());

describe("JSON-LD context policy", () => {
  it("refuses remote contexts by default without using global fetch", async () => {
    const globalFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", globalFetch);
    await expect(parseRdf(body, "application/ld+json")).rejects.toBeInstanceOf(RdfFetchError);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("uses an explicit offline document loader", async () => {
    const load = vi.fn(async () => context);
    const dataset = await parseRdf(body, "application/ld+json", { documentLoader: { load } });
    expect(dataset.size).toBe(1);
    expect([...dataset][0]?.object.value).toBe("Alice");
    expect(load).toHaveBeenCalledWith(contextUrl);
  });

  it("loads allowed contexts only through the injected transport, with redirects refused", async () => {
    const globalFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", globalFetch);
    const transport = vi.fn<typeof fetch>(async () => Response.json(context));
    const documentLoader = createFetchDocumentLoader(transport, {
      allow: (url) => url === contextUrl,
    });
    const dataset = await parseRdf(body, "application/ld+json", { documentLoader });
    expect(dataset.size).toBe(1);
    expect([...dataset][0]?.predicate.value).toBe("https://schema.org/name");
    expect(transport).toHaveBeenCalledExactlyOnceWith(contextUrl, {
      headers: new Headers({ accept: "application/ld+json" }),
      redirect: "error",
    });
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("rejects unallowlisted URLs before fetching", async () => {
    const transport = vi.fn<typeof fetch>();
    const documentLoader = createFetchDocumentLoader(transport, { allow: () => false });
    await expect(documentLoader.load(contextUrl)).rejects.toMatchObject({
      name: "RdfFetchError",
      url: contextUrl,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("checks nested remote contexts against the allowlist too", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ "@context": "https://untrusted.example/context" }),
    );
    const documentLoader = createFetchDocumentLoader(transport, {
      allow: (url) => url === contextUrl,
    });
    await expect(parseRdf(body, "application/ld+json", { documentLoader })).rejects.toBeInstanceOf(
      RdfFetchError,
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    "network",
    "json",
    "http",
  ])("wraps %s context failures in typed errors", async (failure) => {
    const transport = vi.fn<typeof fetch>(async () => {
      if (failure === "network") throw new TypeError("redirect refused");
      if (failure === "json") return new Response("invalid json");
      return new Response("unavailable", { status: 503 });
    });
    const loader = createFetchDocumentLoader(transport, { allow: () => true });
    await expect(loader.load(contextUrl)).rejects.toMatchObject({
      name: "RdfFetchError",
      url: contextUrl,
    });
  });

  it.each([404, 503])("cancels an unread HTTP %s context response", async (status) => {
    const cancel = vi.fn();
    const responseBody = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(responseBody, { status });
    const loader = createFetchDocumentLoader(
      vi.fn(async () => response),
      { allow: () => true },
    );

    await expect(loader.load(contextUrl)).rejects.toMatchObject({
      name: "RdfFetchError",
      status,
      url: contextUrl,
      message: `HTTP ${status} loading JSON-LD context ${contextUrl}.`,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(responseBody.locked).toBe(false);
  });

  it("awaits context response cancellation before exposing the HTTP error", async () => {
    let finishCancellation = () => {};
    const pending = new Promise<void>((resolve) => {
      finishCancellation = resolve;
    });
    const cancel = vi.fn(() => pending);
    const response = new Response(new ReadableStream({ cancel }), { status: 403 });
    const loader = createFetchDocumentLoader(
      vi.fn(async () => response),
      { allow: () => true },
    );
    const rejected = vi.fn();
    const result = loader.load(contextUrl).catch(rejected);

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(rejected).not.toHaveBeenCalled();
    finishCancellation();
    await result;
    expect(rejected).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "RdfFetchError", status: 403, url: contextUrl }),
    );
  });

  it("preserves the context HTTP error when cancellation rejects", async () => {
    const cancel = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    const response = new Response(new ReadableStream({ cancel }), { status: 500 });
    const loader = createFetchDocumentLoader(
      vi.fn(async () => response),
      { allow: () => true },
    );

    await expect(loader.load(contextUrl)).rejects.toMatchObject({
      name: "RdfFetchError",
      status: 500,
      url: contextUrl,
      message: `HTTP 500 loading JSON-LD context ${contextUrl}.`,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("preserves the context HTTP error for an already-locked body", async () => {
    const responseBody = new ReadableStream<Uint8Array>();
    const response = new Response(responseBody, { status: 500 });
    const reader = responseBody.getReader();
    const loader = createFetchDocumentLoader(
      vi.fn(async () => response),
      { allow: () => true },
    );

    try {
      await expect(loader.load(contextUrl)).rejects.toMatchObject({
        name: "RdfFetchError",
        status: 500,
        url: contextUrl,
      });
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it("preserves the context HTTP error when the response has no body", async () => {
    const response = new Response(null, { status: 500 });
    const loader = createFetchDocumentLoader(
      vi.fn(async () => response),
      { allow: () => true },
    );

    await expect(loader.load(contextUrl)).rejects.toMatchObject({
      name: "RdfFetchError",
      status: 500,
      url: contextUrl,
    });
  });

  it("fetchRdf refuses contexts by default and forwards an explicit loader", async () => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response(body, { headers: { "content-type": "application/ld+json" } }),
    );
    await expect(
      fetchRdf("https://example.org/profile", { fetch: transport }),
    ).rejects.toBeInstanceOf(RdfFetchError);
    const load = vi.fn(async () => context);
    const result = await fetchRdf("https://example.org/profile", {
      fetch: transport,
      documentLoader: { load },
    });
    expect(result.dataset.size).toBe(1);
    expect(load).toHaveBeenCalledWith(contextUrl);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
