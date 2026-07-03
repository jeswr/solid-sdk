// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Offline logging + reconcile + owner-only ACL — the outbox behaviour behind UX
 * invariants #2/#3 and the "all writes owner-only" acceptance.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiaryStore } from "../cache/diary-store";
import { MemoryKv } from "../cache/kv";
import { resetDiaryReadyMemo } from "../pod/pod-fs";
import { newConclusionRecord, newProtocolRecord } from "../protocol/persist";
import { newMealRecord, newSymptomRecord } from "./log";
import { flushOutbox } from "./sync";

const ROOT = "https://alice.example/";
const WEBID = "https://alice.example/profile/card#me";

interface Scenario {
  fetch: typeof globalThis.fetch;
  puts: () => { url: string; body?: string }[];
  failMealPut: { current: boolean };
}

/** A fetch that can be toggled to fail meal PUTs (simulate offline). */
function scenario(): Scenario {
  const puts: { url: string; body?: string }[] = [];
  const failMealPut = { current: false };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") return new Response(null, { status: 200 });
    if (method === "PUT") {
      const body = typeof init?.body === "string" ? init.body : undefined;
      const isMeal = url.includes("/meals/");
      if (isMeal && failMealPut.current) throw new TypeError("Failed to fetch");
      puts.push({ url, body });
      return new Response("", { status: 201 });
    }
    return new Response("", { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, puts: () => puts, failMealPut };
}

beforeEach(() => resetDiaryReadyMemo());

describe("flushOutbox", () => {
  it("syncs a pending meal to the pod, ACL-first, owner-only", async () => {
    const s = scenario();
    const store = new DiaryStore(new MemoryKv(), WEBID);
    const meal = newMealRecord({ storageRoot: ROOT, items: [{ name: "Porridge" }] });
    await store.putMeal(meal);

    const result = await flushOutbox({ authedFetch: s.fetch, webId: WEBID, storageRoot: ROOT }, store);
    expect(result).toEqual({ synced: 1, failed: 0 });

    const urls = s.puts().map((p) => p.url);
    const aclIdx = urls.findIndex((u) => u.endsWith("/health/diary/.acl"));
    const mealIdx = urls.findIndex((u) => u === meal.url);
    expect(aclIdx).toBeGreaterThanOrEqual(0);
    expect(mealIdx).toBeGreaterThan(aclIdx); // ACL written before the meal
    // No public grant in the ACL.
    const acl = s.puts().find((p) => p.url.endsWith("/health/diary/.acl"));
    expect(acl?.body ?? "").not.toMatch(/agentClass|foaf:Agent|Public/i);
    // The meal is marked synced in the cache.
    expect((await store.pending()).meals).toHaveLength(0);
  });

  it("keeps a meal in the outbox when offline, then syncs on reconnect", async () => {
    const s = scenario();
    const store = new DiaryStore(new MemoryKv(), WEBID);
    const meal = newMealRecord({ storageRoot: ROOT, items: [{ name: "Toast" }] });
    await store.putMeal(meal); // optimistic — already in the cache

    // Offline: the meal PUT fails.
    s.failMealPut.current = true;
    const offline = await flushOutbox({ authedFetch: s.fetch, webId: WEBID, storageRoot: ROOT }, store);
    expect(offline.failed).toBe(1);
    let pending = await store.pending();
    expect(pending.meals).toHaveLength(1);
    expect(pending.meals[0].sync).toBe("error");

    // Reconnect: a re-flush succeeds — the log was never lost.
    resetDiaryReadyMemo();
    s.failMealPut.current = false;
    const online = await flushOutbox({ authedFetch: s.fetch, webId: WEBID, storageRoot: ROOT }, store);
    expect(online.synced).toBe(1);
    pending = await store.pending();
    expect(pending.meals).toHaveLength(0);
  });

  it("syncs a symptom too", async () => {
    const s = scenario();
    const store = new DiaryStore(new MemoryKv(), WEBID);
    const symptom = newSymptomRecord({ storageRoot: ROOT, symptomType: "bloating", severity: 6 });
    await store.putSymptom(symptom);
    const result = await flushOutbox({ authedFetch: s.fetch, webId: WEBID, storageRoot: ROOT }, store);
    expect(result.synced).toBe(1);
    expect(s.puts().some((p) => p.url === symptom.url)).toBe(true);
  });

  it("syncs a protocol + conclusion to their containers, ACL-first, owner-only", async () => {
    const s = scenario();
    const store = new DiaryStore(new MemoryKv(), WEBID);
    const proto = newProtocolRecord(
      { targetTrigger: "lactose", phase: "baseline", created: new Date("2026-07-01T08:00:00Z") },
      ROOT,
    );
    await store.putProtocol(proto);
    const conc = newConclusionRecord(
      { aboutTrigger: "lactose", verdict: "reacts", confidence: "confirmed" },
      ROOT,
      proto.ulid,
    );
    await store.putConclusion(conc);

    const result = await flushOutbox({ authedFetch: s.fetch, webId: WEBID, storageRoot: ROOT }, store);
    expect(result.synced).toBe(2);
    const urls = s.puts().map((p) => p.url);
    expect(urls).toContain(proto.url);
    expect(urls).toContain(conc.url);
    // ACL (owner-only) is written on the diary root before any resource under it.
    const aclIdx = urls.findIndex((u) => u.endsWith(".acl") || u.includes("/.acl"));
    const protoIdx = urls.indexOf(proto.url);
    expect(aclIdx).toBeGreaterThanOrEqual(0);
    expect(aclIdx).toBeLessThan(protoIdx);
    expect((await store.pending()).protocols).toHaveLength(0);
  });

  it("defers a conclusion whose source protocol has NOT synced (no orphan confirmed conclusion)", async () => {
    // A fetch that fails every protocol PUT (protocol never lands on the pod).
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "HEAD") return new Response(null, { status: 200 });
      if (method === "PUT" && url.includes("/protocols/")) throw new TypeError("Failed to fetch");
      return new Response("", { status: 201 });
    }) as unknown as typeof globalThis.fetch;

    const store = new DiaryStore(new MemoryKv(), WEBID);
    const proto = newProtocolRecord(
      { targetTrigger: "lactose", phase: "concluded", created: new Date("2026-07-01T08:00:00Z") },
      ROOT,
    );
    await store.putProtocol(proto);
    const conc = newConclusionRecord(
      { aboutTrigger: "lactose", verdict: "reacts", confidence: "confirmed" },
      ROOT,
      proto.ulid,
    );
    await store.putConclusion(conc);

    const result = await flushOutbox({ authedFetch: fetch, webId: WEBID, storageRoot: ROOT }, store);
    expect(result.failed).toBe(1); // the protocol PUT failed
    // The conclusion was DEFERRED (not synced, not failed) — still pending for retry.
    const pending = await store.pending();
    expect(pending.protocols).toHaveLength(1);
    expect(pending.conclusions).toHaveLength(1);
    expect(pending.conclusions[0].sync).toBe("pending");
  });
});
