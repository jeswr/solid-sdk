// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import { ResourceDeleteError, ResourceWriteError } from "./errors.js";
import {
  deleteRdf,
  nameFromUrl,
  REVALIDATE_HEADERS,
  readRdf,
  serializeTurtle,
  writeRdf,
} from "./rdf-io.js";
import { mockFetch, turtleToStore } from "./test-helpers.js";

const URL_X = "https://alice.pod/pod-chat/messages/x.ttl";

describe("serializeTurtle", () => {
  it("serialises a dataset to Turtle with prefixes", async () => {
    const store = turtleToStore(
      `@prefix as: <https://www.w3.org/ns/activitystreams#> . <#it> as:content "Hi" .`,
      URL_X,
    );
    const ttl = await serializeTurtle(store, { as: "https://www.w3.org/ns/activitystreams#" });
    expect(ttl).toContain("Hi");
    expect(ttl).toContain("as:content");
  });

  it("serialises with no prefixes argument", async () => {
    const store = new Store();
    const ttl = await serializeTurtle(store);
    expect(typeof ttl).toBe("string");
  });

  it("rejects when iterating the dataset throws (executor-level failure)", async () => {
    // Whatever the source of a serialisation failure (a hostile dataset, a
    // Writer error), it must surface as a rejected promise rather than a
    // swallowed one. A throwing iterator exercises that contract.
    const exploding = {
      [Symbol.iterator]() {
        throw new Error("iteration blew up");
      },
    } as unknown as import("@rdfjs/types").DatasetCore;
    await expect(serializeTurtle(exploding)).rejects.toThrow("iteration blew up");
  });

  it("rejects when the n3 Writer's end callback reports an error", async () => {
    // Cover the `err ? reject(err)` branch: stub the Writer so `end` calls back
    // with an error (n3 itself rarely errors on well-formed quads).
    const n3 = await import("n3");
    const original = n3.Writer.prototype.end;
    n3.Writer.prototype.end = function endStub(
      this: unknown,
      cb?: (e: Error | null, r: string) => void,
    ) {
      cb?.(new Error("writer failed"), "");
    } as typeof original;
    try {
      await expect(serializeTurtle(new Store())).rejects.toThrow("writer failed");
    } finally {
      n3.Writer.prototype.end = original;
    }
  });
});

describe("readRdf", () => {
  it("reads + parses a resource and sends the revalidate header", async () => {
    const { fetch, calls } = mockFetch({
      [`GET ${URL_X}`]: {
        body: `@prefix as: <https://www.w3.org/ns/activitystreams#> . <#it> as:content "T" .`,
        etag: 'W/"abc"',
      },
    });
    const { dataset, etag, contentType } = await readRdf(URL_X, fetch);
    expect([...dataset]).toHaveLength(1);
    expect(etag).toBe('W/"abc"');
    expect(contentType).toBe("text/turtle");
    expect(calls[0]?.headers["cache-control"]).toBe(REVALIDATE_HEADERS["cache-control"]);
  });

  it("throws RdfFetchError with .status on a 404", async () => {
    const { fetch } = mockFetch({});
    await expect(readRdf(URL_X, fetch)).rejects.toMatchObject({ status: 404 });
    await expect(readRdf(URL_X, fetch)).rejects.toBeInstanceOf(RdfFetchError);
  });

  it("uses the global fetch when no fetchImpl is given (production path)", async () => {
    const original = globalThis.fetch;
    let sentCacheControl: string | null = null;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      sentCacheControl = h.get("cache-control");
      return new Response(
        `@prefix as: <https://www.w3.org/ns/activitystreams#> . <#it> as:content "G" .`,
        { status: 200, headers: { "content-type": "text/turtle", etag: 'W/"g"' } },
      );
    }) as typeof fetch;
    try {
      const { etag } = await readRdf(URL_X);
      expect(etag).toBe('W/"g"');
      expect(sentCacheControl).toBe(REVALIDATE_HEADERS["cache-control"]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("writeRdf", () => {
  it("PUTs Turtle with an explicit content-type and returns the new etag", async () => {
    const { fetch, calls } = mockFetch({ [`PUT ${URL_X}`]: { status: 201, etag: 'W/"new"' } });
    const store = turtleToStore(`<#it> <http://example/p> "v" .`, URL_X);
    const { etag } = await writeRdf(URL_X, store, { fetchImpl: fetch });
    expect(etag).toBe('W/"new"');
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.headers["content-type"]).toBe("text/turtle");
    expect(calls[0]?.headers["if-match"]).toBeUndefined();
    expect(calls[0]?.headers["if-none-match"]).toBeUndefined();
  });

  it("sends If-Match when an etag is supplied", async () => {
    const { fetch, calls } = mockFetch({ [`PUT ${URL_X}`]: { status: 205 } });
    await writeRdf(URL_X, new Store(), { etag: 'W/"old"', fetchImpl: fetch });
    expect(calls[0]?.headers["if-match"]).toBe('W/"old"');
  });

  it("sends If-None-Match:* under createOnly", async () => {
    const { fetch, calls } = mockFetch({ [`PUT ${URL_X}`]: { status: 201 } });
    await writeRdf(URL_X, new Store(), { createOnly: true, fetchImpl: fetch });
    expect(calls[0]?.headers["if-none-match"]).toBe("*");
  });

  it("throws ResourceWriteError with the status on a non-2xx", async () => {
    const { fetch } = mockFetch({ [`PUT ${URL_X}`]: { status: 412 } });
    const err = await writeRdf(URL_X, new Store(), { fetchImpl: fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(ResourceWriteError);
    expect(err.status).toBe(412);
  });

  it("uses the global fetch when no fetchImpl is given (degraded-path coverage)", async () => {
    const original = globalThis.fetch;
    let called = "";
    globalThis.fetch = (async (input: string | URL | Request) => {
      called = typeof input === "string" ? input : input.toString();
      return new Response(null, { status: 201, headers: { etag: 'W/"g"' } });
    }) as typeof fetch;
    try {
      const { etag } = await writeRdf(URL_X, new Store());
      expect(etag).toBe('W/"g"');
      expect(called).toBe(URL_X);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("throws on a non-2xx from the global fetch path too", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
    try {
      const err = await writeRdf(URL_X, new Store()).catch((e) => e);
      expect(err).toBeInstanceOf(ResourceWriteError);
      expect(err.status).toBe(500);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("deleteRdf", () => {
  it("succeeds on a 2xx", async () => {
    const { fetch, calls } = mockFetch({ [`DELETE ${URL_X}`]: { status: 205 } });
    await expect(deleteRdf(URL_X, fetch)).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });

  it("treats 404 and 410 as idempotent success", async () => {
    const { fetch: f404 } = mockFetch({ [`DELETE ${URL_X}`]: { status: 404 } });
    await expect(deleteRdf(URL_X, f404)).resolves.toBeUndefined();
    const { fetch: f410 } = mockFetch({ [`DELETE ${URL_X}`]: { status: 410 } });
    await expect(deleteRdf(URL_X, f410)).resolves.toBeUndefined();
  });

  it("throws ResourceDeleteError on any other non-2xx", async () => {
    const { fetch } = mockFetch({ [`DELETE ${URL_X}`]: { status: 500 } });
    const err = await deleteRdf(URL_X, fetch).catch((e) => e);
    expect(err).toBeInstanceOf(ResourceDeleteError);
    expect(err.status).toBe(500);
  });

  it("uses the global fetch when no fetchImpl is given", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 205 })) as typeof fetch;
    try {
      await expect(deleteRdf(URL_X)).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("throws on a non-2xx from the global fetch path too", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
    try {
      const err = await deleteRdf(URL_X).catch((e) => e);
      expect(err).toBeInstanceOf(ResourceDeleteError);
      expect(err.status).toBe(500);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("nameFromUrl", () => {
  it("returns the last decoded path segment", () => {
    expect(nameFromUrl("https://pod/pod-chat/messages/my%20note.ttl")).toBe("my note.ttl");
  });
  it("falls back to the hostname when the path is empty", () => {
    expect(nameFromUrl("https://pod.example/")).toBe("pod.example");
  });
  it("returns the raw string for an unparseable URL", () => {
    expect(nameFromUrl("::::not a url")).toBe("::::not a url");
  });
});
