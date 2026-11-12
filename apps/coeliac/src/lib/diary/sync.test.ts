// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Offline logging + reconcile + owner-only ACL — the outbox behaviour behind UX
 * invariants #2/#3 and the "all writes owner-only" acceptance.
 */
import { recordingStorage } from "../../../test/storage";
import { StorageError } from "@jeswr/storage-client";
import { beforeEach, describe, expect, it } from "vitest";
import { DiaryStore } from "../cache/diary-store";
import { MemoryKv } from "../cache/kv";
import { resetDiaryReadyMemo } from "../pod/pod-fs";
import { newConclusionRecord, newProtocolRecord } from "../protocol/persist";
import { newMealRecord, newSymptomRecord } from "./log";
import { flushOutbox } from "./sync";

const ROOT = "https://alice.example/";
const WEBID = "https://alice.example/profile/card#me";

/** SDK memory storage with a switchable offline meal write. */
function scenario() {
  const failMealPut = { current: false };
  const r = recordingStorage(ROOT, (call) => {
    if (call.method === "PUT" && call.url.includes("/meals/") && failMealPut.current) {
      throw new TypeError("Failed to fetch");
    }
  });
  return { ...r, failMealPut };
}

beforeEach(() => resetDiaryReadyMemo());

describe("flushOutbox", () => {
  it.each([
    [new StorageError("network", { url: ROOT, method: "HEAD" }), "Failed to fetch"],
    [new StorageError("scope", { url: ROOT, method: "HEAD" }), "Storage location is outside this pod"],
    [Object.assign(new Error(`Discovery failed at ${ROOT}`), {
      name: "CapabilitiesError", code: "description-unreachable", url: ROOT,
    }), "Couldn't discover pod storage"],
    [Object.assign(new Error(`Discovery failed at ${ROOT}`), {
      name: "CapabilitiesError", code: "network", url: ROOT,
    }), "Failed to fetch"],
  ])("stores a short sync error for a status-less SDK failure (%s)", async (failure, message) => {
    const store = new DiaryStore(new MemoryKv(), WEBID);
    const meal = newMealRecord({ storageRoot: ROOT, items: [{ name: "Rice" }] });
    await store.putMeal(meal);
    const storage = async () => { throw failure; };
    expect(await flushOutbox({ storage, webId: WEBID, storageRoot: ROOT }, store)).toEqual({
      synced: 0, failed: 1,
    });
    expect((await store.pending()).meals[0]).toMatchObject({ sync: "error", error: message });
  });

  it("syncs a pending meal to the pod, ACL-first, owner-only", async () => {
    const s = scenario();
    const store = new DiaryStore(new MemoryKv(), WEBID);
    const meal = newMealRecord({ storageRoot: ROOT, items: [{ name: "Porridge" }] });
    await store.putMeal(meal);

    const result = await flushOutbox({ storage: s.storage, webId: WEBID, storageRoot: ROOT }, store);
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
    const offline = await flushOutbox({ storage: s.storage, webId: WEBID, storageRoot: ROOT }, store);
    expect(offline.failed).toBe(1);
    let pending = await store.pending();
    expect(pending.meals).toHaveLength(1);
    expect(pending.meals[0].sync).toBe("error");

    // Reconnect: a re-flush succeeds — the log was never lost.
    resetDiaryReadyMemo();
    s.failMealPut.current = false;
    const online = await flushOutbox({ storage: s.storage, webId: WEBID, storageRoot: ROOT }, store);
    expect(online.synced).toBe(1);
    pending = await store.pending();
    expect(pending.meals).toHaveLength(0);
  });

  it("syncs a symptom too", async () => {
    const s = scenario();
    const store = new DiaryStore(new MemoryKv(), WEBID);
    const symptom = newSymptomRecord({ storageRoot: ROOT, symptomType: "bloating", severity: 6 });
    await store.putSymptom(symptom);
    const result = await flushOutbox({ storage: s.storage, webId: WEBID, storageRoot: ROOT }, store);
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

    const result = await flushOutbox({ storage: s.storage, webId: WEBID, storageRoot: ROOT }, store);
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
    const { storage } = recordingStorage(ROOT, (call) => {
      if (call.method === "PUT" && call.url.includes("/protocols/")) throw new TypeError("Failed to fetch");
    });

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

    const result = await flushOutbox({ storage, webId: WEBID, storageRoot: ROOT }, store);
    expect(result.failed).toBe(1); // the protocol PUT failed
    // The conclusion was DEFERRED (not synced, not failed) — still pending for retry.
    const pending = await store.pending();
    expect(pending.protocols).toHaveLength(1);
    expect(pending.conclusions).toHaveLength(1);
    expect(pending.conclusions[0].sync).toBe("pending");
  });

  it("syncs a genetic summary to its container, ACL-first, owner-only (no public grant)", async () => {
    const s = scenario();
    const store = new DiaryStore(new MemoryKv(), WEBID);
    await store.putGeneticSummary({
      kind: "genetic",
      url: `${ROOT}health/diary/genetics/summary.ttl`,
      markers: [
        { rsid: "rs2187668", riskHaplotype: "DQ2.5", markerPresence: "present" },
        { rsid: "rs7454108", riskHaplotype: "DQ8", markerPresence: "absent" },
      ],
      interpretation: "Carrying DQ2/DQ8 does NOT mean you have coeliac disease. Discuss with your clinician.",
      coeliacGeneticRisk: "risk-haplotype-present",
      coverageComplete: true,
      sourceType: "manual",
      consentGiven: true,
      createdAt: "2026-07-03T00:00:00.000Z",
      rev: "rev-1",
      sync: "pending",
    });

    const result = await flushOutbox({ storage: s.storage, webId: WEBID, storageRoot: ROOT }, store);
    expect(result.synced).toBe(1);
    const urls = s.puts().map((p) => p.url);
    const summaryUrl = `${ROOT}health/diary/genetics/summary.ttl`;
    expect(urls).toContain(summaryUrl);
    const aclIdx = urls.findIndex((u) => u.endsWith("/health/diary/.acl"));
    expect(aclIdx).toBeGreaterThanOrEqual(0);
    expect(aclIdx).toBeLessThan(urls.indexOf(summaryUrl)); // ACL before the summary
    const acl = s.puts().find((p) => p.url.endsWith("/health/diary/.acl"));
    expect(acl?.body ?? "").not.toMatch(/agentClass|foaf:Agent|Public/i);
    expect((await store.pending()).genetics).toHaveLength(0);
  });

  it("a STALE genetic-sync completion never marks a NEWER summary synced (rev-guard)", async () => {
    const store = new DiaryStore(new MemoryKv(), WEBID);
    const base = {
      kind: "genetic" as const,
      url: `${ROOT}health/diary/genetics/summary.ttl`,
      markers: [{ rsid: "rs2187668", riskHaplotype: "DQ2.5" as const, markerPresence: "present" as const }],
      interpretation: "framing",
      consentGiven: true as const,
      createdAt: "2026-07-03T00:00:00.000Z",
      sync: "pending" as const,
    };
    // The FIRST summary (rev A) starts an in-flight write; a NEWER summary (rev B)
    // replaces it before A's write settles.
    await store.putGeneticSummary({ ...base, rev: "A" });
    await store.putGeneticSummary({ ...base, rev: "B" });
    // A's stale completion arrives — it must be ignored.
    await store.markGeneticSync("A", "synced");
    const now = await store.getGeneticSummary();
    expect(now?.rev).toBe("B");
    expect(now?.sync).toBe("pending"); // the newer record is still pending, not lost
  });
});
