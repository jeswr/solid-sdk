// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import solidDriver, { SolidPreconditionFailedError } from "../src/index.js";

vi.unmock("@jeswr/storage-client");
const ROOT = "https://unstorage-factory.example/kv/";
const STORAGE_LINK = '<http://www.w3.org/ns/pim/space#Storage>; rel="type"';

afterEach(() => vi.restoreAllMocks());

describe("legacy fetch construction through the public factory", () => {
  it("retains driver and transaction headers during discovery and data reads", async () => {
    const seen: {
      url: string;
      method: string;
      headers: Headers;
      redirect: RequestRedirect | undefined;
    }[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      seen.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        redirect: init?.redirect,
      });
      if (url === ROOT && init?.method === "HEAD")
        return new Response(null, {
          headers: { link: STORAGE_LINK, "updates-via": "wss://notifications.example/updates" },
        });
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      return new Response("value", { headers: { "content-type": "text/plain", etag: '"e"' } });
    };
    const driver = solidDriver({
      base: ROOT,
      fetch,
      headers: { "x-driver": "yes", "x-override": "default" },
    });
    expect(await driver.getItem?.("a", { headers: { "x-override": "transaction" } })).toBe("value");
    expect(seen.some(({ method }) => method === "HEAD")).toBe(true);
    expect(seen.at(-1)?.url).toBe(`${ROOT}a`);
    for (const { headers, redirect } of seen) {
      expect(headers.get("x-driver")).toBe("yes");
      expect(headers.get("x-override")).toBe("transaction");
      expect(redirect).toBe("manual");
    }
  });

  describe.each(["solid", "lws"] as const)("%s content negotiation", (protocol) => {
    it.each([
      ["lowercase", { accept: "application/ld+json" }, undefined, "application/ld+json"],
      ["mixed-case", { AcCePt: "application/ld+json" }, undefined, "application/ld+json"],
      [
        "transaction",
        { accept: "application/ld+json" },
        { ACCEPT: "application/json" },
        "application/json",
      ],
      ["transaction-only", undefined, { Accept: "application/json" }, "application/json"],
      ["default", undefined, undefined, "*/*"],
    ] as const)("preserves %s resource Accept without changing SDK negotiation", async (name, headers, txHeaders, expected) => {
      const base = `https://unstorage-accept-${protocol}-${name}.example/kv/`;
      const description = new URL("/.well-known/storage", base).href;
      const seen: { url: string; method: string; headers: Headers }[] = [];
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const requestHeaders = new Headers(init?.headers);
        seen.push({ url, method, headers: requestHeaders });
        if (url === base && method === "HEAD")
          return new Response(null, {
            headers: {
              link:
                protocol === "solid"
                  ? `${STORAGE_LINK}, <${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`
                  : `<${description}>; rel="https://www.w3.org/ns/lws#storage"`,
            },
          });
        if (url === description && method === "GET")
          return protocol === "solid"
            ? new Response("", { headers: { "content-type": "text/turtle" } })
            : Response.json({
                "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
                id: description,
                type: "Storage",
                service: [{ type: "StorageRoot", serviceEndpoint: base }],
              });
        if (url === base && method === "OPTIONS") return new Response(null, { status: 204 });
        if (url === `${base}a` && method === "GET")
          return new Response(requestHeaders.get("accept") === "*/*" ? "default" : "negotiated");
        if (url === base && method === "GET")
          return protocol === "solid"
            ? new Response("", { headers: { "content-type": "text/turtle" } })
            : Response.json(
                { type: "Container", items: [] },
                {
                  headers: { "content-type": "application/lws+json" },
                },
              );
        throw new Error(`Unexpected ${method} ${url}`);
      };
      const driver = solidDriver({ base, fetch, headers });
      expect(await driver.getItem?.("a", { headers: txHeaders })).toBe(
        expected === "*/*" ? "default" : "negotiated",
      );
      expect(seen.find(({ url }) => url === `${base}a`)?.headers.get("accept")).toBe(expected);
      // SDK discovery negotiation wins over caller representation defaults.
      expect(seen.find(({ url }) => url === description)?.headers.get("accept")).toBe(
        protocol === "solid"
          ? "application/ld+json, text/turtle;q=0.9"
          : "application/lws+cid, application/cid;q=0.9, application/ld+json;q=0.8",
      );
      expect(await driver.getItemRaw?.("a", { headers: { ACCEPT: "text/plain" } })).toEqual(
        new TextEncoder().encode("negotiated"),
      );
      expect(seen.at(-1)?.headers.get("accept")).toBe("application/octet-stream");
      expect(await driver.getKeys("", {})).toEqual([]);
      expect(seen.at(-1)?.headers.get("accept")).toBe(
        protocol === "solid" ? "text/turtle" : "application/lws+json, application/ld+json;q=0.5",
      );
    });
  });

  describe.each(["setItem", "setItemRaw"] as const)("%s preconditions", (method) => {
    it.each([
      "solid",
      "lws",
    ] as const)("preserves explicit ETags and content types over conflicting %s transaction headers", async (protocol) => {
      const base = `https://unstorage-headers-${protocol}-${method.toLowerCase()}.example/kv/`;
      const description = new URL("/.well-known/storage", base).href;
      const currentEtag = '"current"';
      let stored = "concurrent edit";
      const writes: Headers[] = [];
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const url = String(input);
        const verb = init?.method ?? "GET";
        if (url === base && verb === "HEAD")
          return new Response(null, {
            headers: {
              link:
                protocol === "solid"
                  ? `${STORAGE_LINK}, <${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`
                  : `<${description}>; rel="https://www.w3.org/ns/lws#storage"`,
            },
          });
        if (url === description)
          return protocol === "solid"
            ? new Response("", { headers: { "content-type": "text/turtle" } })
            : Response.json({
                "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
                id: description,
                type: "Storage",
                service: [{ type: "StorageRoot", serviceEndpoint: base }],
              });
        if (verb === "OPTIONS") return new Response(null, { status: 204 });
        if (url === `${base}a` && verb === "PUT") {
          const headers = new Headers(init?.headers);
          writes.push(headers);
          const matches = headers.get("if-match");
          if (matches !== "*" && matches !== currentEtag)
            return new Response(null, { status: 412 });
          stored = await new Response(init?.body).text();
          return new Response(null, { status: 204, headers: { etag: currentEtag } });
        }
        if (url === `${base}a` && verb === "GET")
          return new Response(stored, { headers: { etag: currentEtag } });
        throw new Error(`Unexpected ${verb} ${url}`);
      };
      const driver = solidDriver({
        base,
        fetch,
        headers: { "IF-MATCH": "*", "Content-Type": "driver/type" },
      });
      const options = {
        etag: '"stale"',
        contentType: "application/test",
        headers: { "iF-mAtCh": "*", "CONTENT-TYPE": "transaction/type" },
      };
      const overwrite = method === "setItem" ? "overwrite" : new TextEncoder().encode("overwrite");
      await expect(driver[method]?.("a", overwrite, options)).rejects.toBeInstanceOf(
        SolidPreconditionFailedError,
      );
      expect(stored).toBe("concurrent edit");
      expect(writes).toHaveLength(1);
      expect(writes[0]?.get("if-match")).toBe('"stale"');
      const safe = method === "setItem" ? "safe update" : new TextEncoder().encode("safe update");
      await expect(
        driver[method]?.("a", safe, { ...options, etag: currentEtag }),
      ).resolves.toBeUndefined();
      expect(stored).toBe("safe update");
      expect(writes[1]?.get("if-match")).toBe(currentEtag);
      expect(writes[1]?.get("content-type")).toBe("application/test");
    });

    it.each([
      ["cold", false],
      ["cold", true],
      ["expired", false],
      ["expired", true],
    ] as const)("keeps a resource ETag off %s discovery (stale: %s)", async (cache, stale) => {
      const base = `https://unstorage-${method.toLowerCase()}-${cache}-${stale}.example/kv/`;
      const description = new URL("/.well-known/solid", base).href;
      const currentEtag = '"resource-v1"';
      const etag = stale ? '"stale"' : currentEtag;
      const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
      const seen: { url: string; method: string; headers: Headers }[] = [];
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const headers = new Headers(init?.headers);
        seen.push({ url, method, headers });
        if (url === `${base}a` && method === "PUT") {
          return new Response(null, {
            status: headers.get("if-match") === currentEtag ? 204 : 412,
            headers: { etag: '"resource-v2"' },
          });
        }
        // The root and description have different validators from the resource.
        if (headers.has("if-match")) return new Response(null, { status: 412 });
        if (url === base && method === "HEAD")
          return new Response(null, {
            headers: {
              link: `${STORAGE_LINK}, <${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
              etag: '"root"',
            },
          });
        if (url === description && method === "GET")
          return new Response("", {
            headers: {
              "content-type": "text/turtle",
              "cache-control": "max-age=60",
              etag: '"description"',
            },
          });
        if (url === base && method === "OPTIONS") return new Response(null, { status: 204 });
        if (url === `${base}a` && method === "GET")
          return new Response("old value", { headers: { etag: currentEtag } });
        throw new Error(`Unexpected ${method} ${url}`);
      };
      const driver = solidDriver({ base, fetch, headers: { "x-driver": "yes" } });
      if (cache === "expired") {
        expect(await driver.getItem?.("a", {})).toBe("old value");
        clock.mockReturnValue(61_000);
        seen.length = 0;
      }
      const value = method === "setItem" ? "new value" : new Uint8Array([0, 255, 1]);
      const write = driver[method]?.("a", value, {
        etag,
        headers: {
          "x-call": "yes",
          ...(cache === "expired" ? { "IF-NONE-MATCH": "*" } : {}),
        },
      });
      if (stale) await expect(write).rejects.toBeInstanceOf(SolidPreconditionFailedError);
      else await expect(write).resolves.toBeUndefined();
      expect(seen).toContainEqual({
        url: description,
        method: "GET",
        headers: expect.any(Headers),
      });
      if (cache === "cold")
        expect(seen).toContainEqual({ url: base, method: "HEAD", headers: expect.any(Headers) });
      expect(seen.find(({ url }) => url === description)?.headers.get("if-none-match")).toBe(
        cache === "expired" ? '"description"' : null,
      );
      expect(seen.filter(({ method }) => method === "PUT")).toHaveLength(1);
      for (const request of seen) {
        expect(request.headers.get("if-match")).toBe(request.method === "PUT" ? etag : null);
        expect(request.headers.get("x-driver")).toBe("yes");
        expect(request.headers.get("x-call")).toBe("yes");
      }
    });
  });

  it("never sends headers to a foreign description and gracefully degrades watch", async () => {
    const base = "https://unstorage-poisoned.example/kv/";
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(null, {
        headers: {
          link: `${STORAGE_LINK}, <https://evil.example/description>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
        },
      });
    };
    const onWatchDegrade = vi.fn();
    const driver = solidDriver({
      base,
      fetch,
      watch: true,
      headers: { "x-driver": "yes" },
      onWatchDegrade,
    });
    const unwatch = await driver.watch?.(vi.fn());
    expect(calls).toEqual([base]);
    expect(onWatchDegrade).toHaveBeenCalledWith("notification setup failed");
    unwatch?.();
  });
});
