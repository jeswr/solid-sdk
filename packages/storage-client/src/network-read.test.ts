// Shared security regressions exercised through both public network backends.
import { LinkHeaderOverflowError } from "@jeswr/storage-capabilities";
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
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

describe.each(factories)("$protocol request scope", ({ create }) => {
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

    // The injected transport uses Fetch's standalone Request parser and adds credentials.
    const result = await storage.head("HTTPS://LWS.EXAMPLE:443/a/../safe?token=a%2fb&x=1&x=2");
    expect(result.url).toBe(`${ROOT}safe?token=a%2fb&x=1&x=2`);
    expect(requests.map(({ url }) => url)).toEqual([result.url]);
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer probe");
    expect(fetch.mock.calls[0]?.[0]).toBe(result.url);
  });
});

describe.each(factories)("$protocol authoritative Link bounds", ({ create, protocol }) => {
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
