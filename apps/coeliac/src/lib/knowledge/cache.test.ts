// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Knowledge pod cache (§3.5): public-JSON round-trip under the diary root, the
 * "ACL written first" invariant, staleness, and best-effort (never throws).
 */
import { describe, expect, it, vi } from "vitest";
import { resetDiaryReadyMemo } from "../pod/pod-fs";
import { knowledgeCacheUrl } from "../pod/layout";
import { DEFAULT_MAX_AGE_MS, isStale, readKnowledgeCache, writeKnowledgeCache } from "./cache";

const ROOT = "https://alice.example/";
const WEBID = "https://alice.example/profile/card#me";

/** A recording stub: HEAD → 200, others → 200; GET returns whatever was PUT to that URL. */
function store() {
  const bodies = new Map<string, string>();
  const calls: { url: string; method: string }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    if (method === "PUT") {
      bodies.set(url, init?.body as string);
      return new Response("", { status: 201 });
    }
    if (method === "HEAD") return new Response(null, { status: 200 });
    const b = bodies.get(url);
    return b ? new Response(b, { status: 200 }) : new Response("", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, puts: () => calls.filter((c) => c.method === "PUT").map((c) => c.url) };
}

describe("knowledge cache", () => {
  it("writes public JSON under …/cache/knowledge/ and round-trips it", async () => {
    resetDiaryReadyMemo();
    const s = store();
    const data = { hitCount: 5, results: [{ id: "1" }] };
    await writeKnowledgeCache(s.fetch, ROOT, WEBID, "research-latest", data);
    const env = await readKnowledgeCache<typeof data>(s.fetch, ROOT, "research-latest");
    expect(env?.data).toEqual(data);
    expect(env?.fetchedAt).toBeTruthy();
    // the cache resource is under the diary cache/knowledge container
    expect(s.puts()).toContain(knowledgeCacheUrl(ROOT, "research-latest"));
  });

  it("writes the owner-only ACL FIRST (before the cache resource)", async () => {
    resetDiaryReadyMemo();
    const s = store();
    await writeKnowledgeCache(s.fetch, ROOT, WEBID, "trials-latest", [1, 2, 3]);
    const puts = s.puts();
    const aclIdx = puts.findIndex((u) => u.endsWith("/health/diary/.acl"));
    const cacheIdx = puts.findIndex((u) => u === knowledgeCacheUrl(ROOT, "trials-latest"));
    expect(aclIdx).toBeGreaterThanOrEqual(0);
    expect(cacheIdx).toBeGreaterThan(aclIdx);
  });

  it("read returns undefined for a missing / malformed cache (never throws)", async () => {
    const s = store();
    expect(await readKnowledgeCache(s.fetch, ROOT, "missing")).toBeUndefined();
  });

  it("write is best-effort — a failing fetch never throws", async () => {
    resetDiaryReadyMemo();
    const bad = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;
    await expect(writeKnowledgeCache(bad, ROOT, WEBID, "research-latest", { x: 1 })).resolves.toBeUndefined();
  });

  it("staleness respects the 24h default window", () => {
    const now = new Date("2026-07-03T12:00:00Z");
    expect(isStale({ fetchedAt: "2026-07-03T11:00:00Z" }, now)).toBe(false);
    expect(isStale({ fetchedAt: "2026-07-01T00:00:00Z" }, now)).toBe(true);
    expect(isStale({ fetchedAt: "not-a-date" }, now)).toBe(true);
    expect(DEFAULT_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });
});
