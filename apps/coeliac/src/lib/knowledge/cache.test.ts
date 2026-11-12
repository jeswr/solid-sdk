// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Knowledge pod cache (§3.5): public-JSON round-trip under the diary root, the
 * "ACL written first" invariant, staleness, and best-effort (never throws).
 */
import { recordingStorage } from "../../../test/storage";
import { describe, expect, it } from "vitest";
import { resetDiaryReadyMemo } from "../pod/pod-fs";
import { knowledgeCacheUrl } from "../pod/layout";
import { DEFAULT_MAX_AGE_MS, isStale, readKnowledgeCache, writeKnowledgeCache } from "./cache";

const ROOT = "https://alice.example/";
const WEBID = "https://alice.example/profile/card#me";

function store() {
  const r = recordingStorage();
  return { ...r, puts: () => r.puts().map((call) => call.url) };
}

describe("knowledge cache", () => {
  it("writes public JSON under …/cache/knowledge/ and round-trips it", async () => {
    resetDiaryReadyMemo();
    const s = store();
    const data = { hitCount: 5, results: [{ id: "1" }] };
    await writeKnowledgeCache(s.storage, ROOT, WEBID, "research-latest", data);
    const env = await readKnowledgeCache<typeof data>(s.storage, ROOT, "research-latest");
    expect(env?.data).toEqual(data);
    expect(env?.fetchedAt).toBeTruthy();
    // the cache resource is under the diary cache/knowledge container
    expect(s.puts()).toContain(knowledgeCacheUrl(ROOT, "research-latest"));
  });

  it("writes the owner-only ACL FIRST (before the cache resource)", async () => {
    resetDiaryReadyMemo();
    const s = store();
    await writeKnowledgeCache(s.storage, ROOT, WEBID, "trials-latest", [1, 2, 3]);
    const puts = s.puts();
    const aclIdx = puts.findIndex((u) => u.endsWith("/health/diary/.acl"));
    const cacheIdx = puts.findIndex((u) => u === knowledgeCacheUrl(ROOT, "trials-latest"));
    expect(aclIdx).toBeGreaterThanOrEqual(0);
    expect(cacheIdx).toBeGreaterThan(aclIdx);
  });

  it("read returns undefined for a missing / malformed cache (never throws)", async () => {
    const s = store();
    expect(await readKnowledgeCache(s.storage, ROOT, "missing")).toBeUndefined();
  });

  it("write is best-effort — a failing fetch never throws", async () => {
    resetDiaryReadyMemo();
    const { storage: bad } = recordingStorage(ROOT, () => { throw new Error("network down"); });
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
