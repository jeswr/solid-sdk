// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { recordingStorage } from "../../../test/storage";
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
    const { storage, puts } = recordingStorage();
    const off = vi.fn(async () => new Response(JSON.stringify(APRICOTS), { status: 200 }));
    const { product, source } = await resolveProduct("3800000000000", {
      publicFetch: off as unknown as typeof globalThis.fetch,
      storage,
      storageRoot: "https://alice.example/",
      webId: WEBID,
    });
    expect(source).toBe("off");
    expect(product.name).toBe("Dried Apricots");
    // write-through fires asynchronously (ACL-first, then the cache PUT) — poll.
    for (let i = 0; i < 50 && !puts().some((call) => call.url.endsWith("/cache/off/3800000000000.ttl")); i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    // The owner-only ACL was written, AND before the cache resource (both must
    // exist — a missing ACL write must not pass this vacuously via findIndex -1).
    const aclIndex = puts().findIndex((call) => call.url.endsWith("/health/diary/.acl"));
    const cacheIndex = puts().findIndex((call) => call.url.endsWith("/cache/off/3800000000000.ttl"));
    expect(aclIndex).toBeGreaterThanOrEqual(0);
    expect(cacheIndex).toBeGreaterThanOrEqual(0);
    expect(aclIndex).toBeLessThan(cacheIndex);
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
    const { storage } = recordingStorage();
    await storage.write(cacheUrl, ttl, { contentType: "text/turtle", ifMatch: "*" });

    const { product, source } = await resolveProduct("3800000000000", {
      publicFetch: off as unknown as typeof globalThis.fetch,
      storage,
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
    const { storage } = recordingStorage();
    await expect(
      resolveProduct("3800000000000", {
        publicFetch: off as unknown as typeof globalThis.fetch,
        storage,
        storageRoot: "https://alice.example/",
        webId: WEBID,
      }),
    ).rejects.toThrow();
  });
});
