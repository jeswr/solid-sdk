// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDiaryReadyMemo } from "../pod/pod-fs";
import { serializeOffCache } from "./cache";
import { resolveProduct } from "./resolve";

const WEBID = "https://alice.example/profile/card#me";

beforeEach(() => resetDiaryReadyMemo());

const APRICOTS = {
  status: 1,
  product: { code: "3800000000000", product_name: "Dried Apricots", categories_tags: ["en:dried-apricots"] },
};

describe("resolveProduct", () => {
  it("returns the live OFF product (source: off) and writes through to the cache", async () => {
    const puts: string[] = [];
    const off = vi.fn(async () => new Response(JSON.stringify(APRICOTS), { status: 200 }));
    const authed = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "PUT") puts.push(input.toString());
      return new Response("", { status: 201 });
    }) as unknown as typeof globalThis.fetch;
    const { product, source } = await resolveProduct("3800000000000", {
      publicFetch: off as unknown as typeof globalThis.fetch,
      authedFetch: authed,
      storageRoot: "https://alice.example/",
      webId: WEBID,
    });
    expect(source).toBe("off");
    expect(product.name).toBe("Dried Apricots");
    // write-through fires asynchronously (ACL-first, then the cache PUT) — poll.
    for (let i = 0; i < 50 && !puts.some((u) => u.endsWith("/cache/off/3800000000000.ttl")); i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(puts.some((u) => u.endsWith("/cache/off/3800000000000.ttl"))).toBe(true);
    // The owner-only ACL was written before the cache resource.
    expect(puts.findIndex((u) => u.endsWith("/health/diary/.acl"))).toBeLessThan(
      puts.findIndex((u) => u.endsWith("/cache/off/3800000000000.ttl")),
    );
  });

  it("falls back to the pod cache on a network error (offline)", async () => {
    const off = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    // Serve the cached FoodItem doc from the authed fetch.
    const cacheUrl = "https://alice.example/health/diary/cache/off/3800000000000.ttl";
    const ttl = await serializeOffCache(cacheUrl, {
      barcode: "3800000000000",
      found: true,
      name: "Dried Apricots",
      allergensTags: [],
      tracesTags: [],
      additivesTags: [],
      categoriesTags: ["en:dried-apricots"],
      dataQualityTags: [],
      attribution: "Open Food Facts",
      sourceUrl: "https://world.openfoodfacts.org/product/3800000000000",
    });
    const authed = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString() === cacheUrl) {
        return new Response(ttl, { status: 200, headers: { "content-type": "text/turtle" } });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { product, source } = await resolveProduct("3800000000000", {
      publicFetch: off as unknown as typeof globalThis.fetch,
      authedFetch: authed,
      storageRoot: "https://alice.example/",
      webId: WEBID,
    });
    expect(source).toBe("cache");
    expect(product.name).toBe("Dried Apricots");
  });

  it("re-throws when offline with no cached fallback", async () => {
    const off = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const authed = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof globalThis.fetch;
    await expect(
      resolveProduct("3800000000000", {
        publicFetch: off as unknown as typeof globalThis.fetch,
        authedFetch: authed,
        storageRoot: "https://alice.example/",
        webId: WEBID,
      }),
    ).rejects.toThrow();
  });
});
