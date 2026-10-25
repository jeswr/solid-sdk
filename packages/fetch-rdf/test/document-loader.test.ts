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
