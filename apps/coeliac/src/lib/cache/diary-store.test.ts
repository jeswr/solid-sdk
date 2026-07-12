// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import { newMealRecord, newSymptomRecord } from "../diary/log";
import { DiaryStore, mealLabel, mealSignature } from "./diary-store";
import type { Kv } from "./kv";
import { MemoryKv } from "./kv";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A Kv whose `set` pauses on `gate` — everything else is immediate. */
class GatedSetKv implements Kv {
  constructor(
    private readonly inner: Kv,
    private readonly gate: Promise<void>,
  ) {}
  async get<T>(key: string): Promise<T | undefined> {
    return this.inner.get<T>(key);
  }
  async set<T>(key: string, value: T): Promise<void> {
    await this.gate;
    return this.inner.set(key, value);
  }
  async del(key: string): Promise<void> {
    return this.inner.del(key);
  }
  async keys(prefix?: string): Promise<string[]> {
    return this.inner.keys(prefix);
  }
}

/**
 * Like {@link GatedSetKv} but its `set` only pauses once {@link armed} is flipped
 * true — so a record can be SEEDED (armed=false, immediate) and only a LATER
 * write gated. Needed to exercise a read-then-write path like `markMealSync`,
 * whose target record must already exist before its gated `set` runs.
 */
class ArmableGatedSetKv implements Kv {
  armed = false;
  /**
   * Resolves the first time an ARMED `set` is ENTERED — i.e. the gated write is
   * genuinely in flight (its promise has been handed back to the caller's
   * `write()` wrapper and registered in `pendingWrites`) — BEFORE it blocks on
   * the gate. A test awaits this before calling `purge()` so the write is
   * provably pending in `pendingWrites`, not merely scheduled: for a
   * read-then-write path like `markMealSync` (which `await`s `kv.get` first),
   * calling `purge()` too early would make its later `set` no-op via the
   * `isPurged()` fail-closed check instead of exercising the drain.
   */
  readonly gatedSetEntered: Promise<void>;
  private markEntered!: () => void;
  constructor(
    private readonly inner: Kv,
    private readonly gate: Promise<void>,
  ) {
    this.gatedSetEntered = new Promise<void>((resolve) => {
      this.markEntered = resolve;
    });
  }
  async get<T>(key: string): Promise<T | undefined> {
    return this.inner.get<T>(key);
  }
  async set<T>(key: string, value: T): Promise<void> {
    if (this.armed) {
      this.markEntered();
      await this.gate;
    }
    return this.inner.set(key, value);
  }
  async del(key: string): Promise<void> {
    return this.inner.del(key);
  }
  async keys(prefix?: string): Promise<string[]> {
    return this.inner.keys(prefix);
  }
}

const ROOT = "https://alice.example/";

function store(scope = "https://alice.example/profile/card#me") {
  return new DiaryStore(new MemoryKv(), scope);
}

describe("meal signature + label", () => {
  it("keys by barcode when present, else by name", () => {
    expect(mealSignature([{ offBarcode: "123" }, { name: "Toast" }])).toBe("b:123|n:toast");
    expect(mealSignature([{ name: "" }])).toBe("");
  });
  it("labels by joined item names", () => {
    expect(mealLabel([{ name: "Porridge" }, { name: "Oat milk" }])).toBe("Porridge, Oat milk");
    expect(mealLabel([{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }])).toBe("a, b, c +1");
  });
});

describe("DiaryStore", () => {
  it("returns recent meals newest-first, one per signature", async () => {
    const s = store();
    const early = newMealRecord({ storageRoot: ROOT, items: [{ name: "Porridge" }], at: new Date("2026-07-01T08:00:00Z") });
    const late = newMealRecord({ storageRoot: ROOT, items: [{ name: "Porridge" }], at: new Date("2026-07-03T08:00:00Z") });
    const other = newMealRecord({ storageRoot: ROOT, items: [{ name: "Salad" }], at: new Date("2026-07-02T12:00:00Z") });
    await s.putMeal(early);
    await s.putMeal(late);
    await s.putMeal(other);
    const recent = await s.recentMeals();
    expect(recent.map((m) => m.label)).toEqual(["Porridge", "Salad"]);
    expect(recent[0].ulid).toBe(late.ulid);
  });

  it("groups frequent meals by signature with counts", async () => {
    const s = store();
    for (let i = 0; i < 3; i++) {
      await s.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Porridge" }], at: new Date(`2026-07-0${i + 1}T08:00:00Z`) }));
    }
    await s.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Salad" }] }));
    const frequent = await s.frequentMeals();
    expect(frequent[0].label).toBe("Porridge");
    expect(frequent[0].count).toBe(3);
  });

  it("tracks pending records + sync-state transitions", async () => {
    const s = store();
    const meal = newMealRecord({ storageRoot: ROOT, items: [{ name: "Toast" }] });
    const symptom = newSymptomRecord({ storageRoot: ROOT, symptomType: "bloating" });
    await s.putMeal(meal);
    await s.putSymptom(symptom);
    expect((await s.pending()).meals).toHaveLength(1);
    await s.markMealSync(meal.ulid, "synced");
    await s.markSymptomSync(symptom.ulid, "error", "offline");
    const pending = await s.pending();
    expect(pending.meals).toHaveLength(0);
    expect(pending.symptoms).toHaveLength(1);
    expect(pending.symptoms[0].error).toBe("offline");
  });

  it("stores + updates a protocol in place, and lists conclusions", async () => {
    const s = store();
    const proto = {
      kind: "protocol" as const,
      ulid: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      url: `${ROOT}health/diary/protocols/01ARZ3NDEKTSV4RRFFQ69G5FAV.ttl`,
      targetTrigger: "lactose" as const,
      phase: "baseline" as const,
      createdAt: "2026-07-01T08:00:00.000Z",
      updatedAt: "2026-07-01T08:00:00.000Z",
      sync: "pending" as const,
    };
    await s.putProtocol(proto);
    expect((await s.getProtocol(proto.ulid))?.phase).toBe("baseline");
    // Update in place (same ulid/url).
    await s.putProtocol({ ...proto, phase: "eliminate", updatedAt: "2026-07-02T08:00:00.000Z" });
    const all = await s.allProtocols();
    expect(all).toHaveLength(1);
    expect(all[0].phase).toBe("eliminate");

    const conc = {
      kind: "conclusion" as const,
      ulid: "01ARZ3NDEKTSV4RRFFQ69G5FBW",
      url: `${ROOT}health/diary/conclusions/01ARZ3NDEKTSV4RRFFQ69G5FBW.ttl`,
      aboutTrigger: "lactose" as const,
      verdict: "reacts" as const,
      confidence: "confirmed" as const,
      protocolUlid: proto.ulid,
      createdAt: "2026-07-10T08:00:00.000Z",
      sync: "pending" as const,
    };
    await s.putConclusion(conc);
    expect((await s.allConclusions())[0].verdict).toBe("reacts");
  });

  it("includes pending protocols + conclusions in the outbox", async () => {
    const s = store();
    await s.putProtocol({
      kind: "protocol",
      ulid: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      url: `${ROOT}health/diary/protocols/01ARZ3NDEKTSV4RRFFQ69G5FAV.ttl`,
      targetTrigger: "lactose",
      phase: "baseline",
      createdAt: "2026-07-01T08:00:00.000Z",
      updatedAt: "2026-07-01T08:00:00.000Z",
      sync: "pending",
    });
    const pending = await s.pending();
    expect(pending.protocols).toHaveLength(1);
    expect(pending.conclusions).toHaveLength(0);
    await s.markProtocolSync("01ARZ3NDEKTSV4RRFFQ69G5FAV", "synced");
    expect((await s.pending()).protocols).toHaveLength(0);
  });

  it("namespaces by scope so accounts never cross-read (shared kv)", async () => {
    const kv = new MemoryKv();
    const alice = new DiaryStore(kv, "https://alice.example/#me");
    const bob = new DiaryStore(kv, "https://bob.example/#me");
    await alice.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: "Secret" }] }));
    // Same underlying kv, different scope — bob must NOT see alice's meal.
    expect((await alice.allMeals()).length).toBe(1);
    expect((await bob.allMeals()).length).toBe(0);
  });
});

/** Seed one record of every kind for a store (pending by default). */
async function seedEveryKind(s: DiaryStore, prefix: string): Promise<void> {
  await s.putMeal(newMealRecord({ storageRoot: ROOT, items: [{ name: `${prefix}-meal` }] }));
  await s.putSymptom(newSymptomRecord({ storageRoot: ROOT, symptomType: "bloating" }));
  await s.putProtocol({
    kind: "protocol",
    ulid: `${prefix}-PROTO`,
    url: `${ROOT}health/diary/protocols/${prefix}.ttl`,
    targetTrigger: "lactose",
    phase: "baseline",
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    sync: "pending",
  });
  await s.putConclusion({
    kind: "conclusion",
    ulid: `${prefix}-CONC`,
    url: `${ROOT}health/diary/conclusions/${prefix}.ttl`,
    aboutTrigger: "lactose",
    verdict: "reacts",
    confidence: "confirmed",
    createdAt: "2026-07-10T08:00:00.000Z",
    sync: "synced", // mix synced + pending — purge must drop both
  });
  await s.putGeneticSummary({
    kind: "genetic",
    url: `${ROOT}health/genetics/summary.ttl`,
    markers: [],
    interpretation: "Negative-predictive only; cannot diagnose.",
    consentGiven: true,
    createdAt: "2026-07-05T08:00:00.000Z",
    rev: `${prefix}-rev`,
    sync: "pending",
  });
  await s.putTriggerClass({
    kind: "triggerClass",
    slug: "lactose",
    lagWindowMin: 1,
    lagWindowMax: 4,
    lagMode: 2,
    sampleSize: 5,
    updatedAt: "2026-07-05T08:00:00.000Z",
  });
  await s.putSafetyContext({
    kind: "safetyContext",
    coeliacDiagnosed: true,
    strictAdherence: true,
    updatedAt: "2026-07-05T08:00:00.000Z",
  });
}

async function isEmpty(s: DiaryStore): Promise<boolean> {
  const [meals, symptoms, protocols, conclusions, genetic, triggerClasses, safetyContext] =
    await Promise.all([
      s.allMeals(),
      s.allSymptoms(),
      s.allProtocols(),
      s.allConclusions(),
      s.getGeneticSummary(),
      s.allTriggerClasses(),
      s.getSafetyContext(),
    ]);
  return (
    meals.length === 0 &&
    symptoms.length === 0 &&
    protocols.length === 0 &&
    conclusions.length === 0 &&
    genetic === undefined &&
    triggerClasses.length === 0 &&
    safetyContext === undefined
  );
}

describe("DiaryStore — learned trigger classes + safety-context (Insights richer-UI)", () => {
  it("stores + overwrites a learned trigger class in place, keyed by slug", async () => {
    const s = store();
    await s.putTriggerClass({
      kind: "triggerClass",
      slug: "gluten",
      lagWindowMin: 2,
      lagWindowMax: 48,
      lagMode: 6,
      sampleSize: 4,
      updatedAt: "2026-07-01T08:00:00.000Z",
    });
    await s.putTriggerClass({
      kind: "triggerClass",
      slug: "lactose",
      lagWindowMin: 1,
      lagWindowMax: 5,
      lagMode: 2,
      sampleSize: 3,
      updatedAt: "2026-07-01T08:00:00.000Z",
    });
    expect((await s.allTriggerClasses()).map((t) => t.slug).sort()).toEqual(["gluten", "lactose"]);

    // Re-learning the SAME trigger overwrites in place — not a second record.
    await s.putTriggerClass({
      kind: "triggerClass",
      slug: "gluten",
      lagWindowMin: 3,
      lagWindowMax: 40,
      lagMode: 8,
      sampleSize: 9,
      updatedAt: "2026-07-10T08:00:00.000Z",
    });
    const all = await s.allTriggerClasses();
    expect(all).toHaveLength(2);
    const gluten = all.find((t) => t.slug === "gluten");
    expect(gluten?.sampleSize).toBe(9);
    expect(gluten?.lagMode).toBe(8);
  });

  it("stores + overwrites the single safety-context record", async () => {
    const s = store();
    expect(await s.getSafetyContext()).toBeUndefined();
    await s.putSafetyContext({
      kind: "safetyContext",
      coeliacDiagnosed: false,
      updatedAt: "2026-07-01T08:00:00.000Z",
    });
    expect((await s.getSafetyContext())?.coeliacDiagnosed).toBe(false);
    await s.putSafetyContext({
      kind: "safetyContext",
      coeliacDiagnosed: true,
      strictAdherence: true,
      alarmFlags: { giBleeding: true },
      updatedAt: "2026-07-10T08:00:00.000Z",
    });
    const ctx = await s.getSafetyContext();
    expect(ctx?.coeliacDiagnosed).toBe(true);
    expect(ctx?.strictAdherence).toBe(true);
    expect(ctx?.alarmFlags?.giBleeding).toBe(true);
  });
});

describe("DiaryStore.purge (logout privacy purge)", () => {
  it("drops every kind for the scope — pending AND synced alike", async () => {
    const s = store();
    await seedEveryKind(s, "a");
    expect(await isEmpty(s)).toBe(false);
    await s.purge();
    expect(await isEmpty(s)).toBe(true);
    // The outbox is empty too — nothing recoverable.
    const pending = await s.pending();
    expect(pending.meals).toHaveLength(0);
    expect(pending.symptoms).toHaveLength(0);
    expect(pending.protocols).toHaveLength(0);
    expect(pending.conclusions).toHaveLength(0);
    expect(pending.genetics).toHaveLength(0);
  });

  it("purges ONLY the departing WebID — another account's cache is untouched", async () => {
    const kv = new MemoryKv();
    const alice = new DiaryStore(kv, "https://alice.example/#me");
    const bob = new DiaryStore(kv, "https://bob.example/#me");
    await seedEveryKind(alice, "alice");
    await seedEveryKind(bob, "bob");
    await alice.purge();
    expect(await isEmpty(alice)).toBe(true);
    // Bob (the other identity on the same shared kv) keeps everything.
    expect(await isEmpty(bob)).toBe(false);
    expect((await bob.allMeals()).length).toBe(1);
    expect(await bob.getGeneticSummary()).toBeDefined();
  });

  it("the `|` delimiter prevents prefix-collision purges (scope A ⊏ scope B textually)", async () => {
    // Without the trailing delimiter, scope "acct" would be a textual prefix of
    // "acct2" and its purge would wrongly wipe the sibling. The `|` boundary stops it.
    const kv = new MemoryKv();
    const acct = new DiaryStore(kv, "acct");
    const acct2 = new DiaryStore(kv, "acct2");
    await seedEveryKind(acct, "x");
    await seedEveryKind(acct2, "y");
    await acct.purge();
    expect(await isEmpty(acct)).toBe(true);
    expect(await isEmpty(acct2)).toBe(false);
  });

  it("is a no-op on an empty store (never throws)", async () => {
    const s = store();
    await expect(s.purge()).resolves.toBeUndefined();
  });

  it("isPurged() flips true SYNCHRONOUSLY the instant purge() is called — the session-race guard's primary check (use-insights.ts)", async () => {
    const s = store();
    expect(s.isPurged()).toBe(false);
    const purging = s.purge();
    // True even before the async purge work has resolved — a concurrent
    // background writer checking mid-flight must see the departure immediately.
    expect(s.isPurged()).toBe(true);
    await purging;
    expect(s.isPurged()).toBe(true);
  });

  it("isPurged() stays true even when the purge itself failed to delete every key", async () => {
    const failingKv = new (class extends MemoryKv {
      override async del(): Promise<void> {
        throw new Error("blocked");
      }
    })();
    const s = new DiaryStore(failingKv, "https://alice.example/#me");
    await seedEveryKind(s, "z");
    await expect(s.purge()).rejects.toThrow();
    // The account is still departing even though the wipe was incomplete — a
    // background writer must not be tricked into treating a failed purge as
    // "safe to write into".
    expect(s.isPurged()).toBe(true);
  });

  it("purge() DRAINS an already-in-flight background write before scanning+deleting (roborev round 3 — closes the TOCTOU a bare isPurged() check leaves open)", async () => {
    // A write that already passed its OWN `isPurged()` check (false) before
    // `purge()` was called is still "in flight" on a slow `kv.set`. If
    // `purge()` scanned+deleted immediately, that write could land AFTER the
    // scan and resurrect the key. `purge()` must wait for it to settle first.
    const gate = deferred<void>();
    const gatedKv = new GatedSetKv(new MemoryKv(), gate.promise);
    const s = new DiaryStore(gatedKv, "https://alice.example/#me");

    const writing = s.putTriggerClass({
      kind: "triggerClass",
      slug: "lactose",
      lagWindowMin: 1,
      lagWindowMax: 3,
      lagMode: 2,
      sampleSize: 5,
      updatedAt: "2026-07-01T08:00:00.000Z",
    });

    // `purge()` is called WHILE that write is still gated — it must block on
    // draining `pendingWrites`, not race ahead to the scan.
    const purging = s.purge();
    let purgeSettled = false;
    void purging.then(() => {
      purgeSettled = true;
    });
    // Give the microtask queue a few turns — purge() must NOT have resolved
    // yet (it's correctly blocked on the gated write).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(purgeSettled).toBe(false);

    gate.resolve();
    await writing;
    await purging;

    // The write landed, then the purge's scan ran AFTER it and removed the
    // key — never the other way around.
    expect(await s.allTriggerClasses()).toEqual([]);
  });

  it("the same drain applies to EVERY write method (roborev round 4 — generalised beyond the two originally-fixed methods)", async () => {
    // putMeal (a plain put) and markMealSync (a read-then-write, part of the
    // optimistic-write outbox reconcile path) both now go through the shared
    // `write()` wrapper — prove the drain closes the race for these too, not
    // just `putTriggerClass`/`putSafetyContext`.
    const gate = deferred<void>();
    const gatedKv = new GatedSetKv(new MemoryKv(), gate.promise);
    const s = new DiaryStore(gatedKv, "https://alice.example/#me");

    const meal = {
      kind: "meal" as const,
      ulid: "m1",
      url: `${ROOT}health/diary/meals/m1.ttl`,
      startTime: "2026-07-01T08:00:00.000Z",
      createdAt: "2026-07-01T08:00:00.000Z",
      items: [{ name: "Toast" }],
      exposures: [],
      signature: "n:toast",
      label: "Toast",
      sync: "pending" as const,
    };

    const writing = s.putMeal(meal);
    const purging = s.purge();
    let purgeSettled = false;
    void purging.then(() => {
      purgeSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(purgeSettled).toBe(false); // still draining the gated putMeal write

    gate.resolve();
    await writing;
    await purging;
    expect(await s.allMeals()).toEqual([]);

    // A FRESH write attempted AFTER purge() has completed is fail-closed —
    // `isPurged()` is now `true`, so it silently no-ops rather than writing.
    await s.putMeal({ ...meal, ulid: "m2" });
    expect(await s.allMeals()).toEqual([]);
  });

  it("the drain also covers the READ-THEN-WRITE outbox path (markMealSync), not just plain puts", async () => {
    // `markMealSync` is the more subtle member of the generalised round-4 fix:
    // it `kv.get`s the meal, THEN does a gated `kv.set` through the shared
    // `write()` wrapper. Seed the meal with the gate disarmed (immediate), then
    // ARM the gate so the sync-state write is genuinely in flight when
    // `purge()` is called — the drain must still block on it, exactly as it
    // does for the plain `putMeal` case above.
    const gate = deferred<void>();
    const gatedKv = new ArmableGatedSetKv(new MemoryKv(), gate.promise);
    const s = new DiaryStore(gatedKv, "https://alice.example/#me");

    const meal = {
      kind: "meal" as const,
      ulid: "m1",
      url: `${ROOT}health/diary/meals/m1.ttl`,
      startTime: "2026-07-01T08:00:00.000Z",
      createdAt: "2026-07-01T08:00:00.000Z",
      items: [{ name: "Toast" }],
      exposures: [],
      signature: "n:toast",
      label: "Toast",
      sync: "pending" as const,
    };
    await s.putMeal(meal); // seeded while the gate is disarmed
    expect(await s.allMeals()).toHaveLength(1);

    gatedKv.armed = true; // from here, every set() blocks on the gate
    const syncing = s.markMealSync(meal.ulid, "synced"); // read (kv.get) THEN a gated write
    // markMealSync `await`s kv.get FIRST, so we must NOT call purge() until its
    // gated set() has actually been entered and registered in pendingWrites —
    // otherwise purge() flips `purged` first and the set no-ops via isPurged(),
    // which would make this test a false positive for the drain (roborev round 5).
    await gatedKv.gatedSetEntered;
    const purging = s.purge();
    let purgeSettled = false;
    void purging.then(() => {
      purgeSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // purge() must be BLOCKED draining the in-flight markMealSync write, not
    // racing ahead to its delete scan (which would let the sync write's set()
    // land afterwards and resurrect the key).
    expect(purgeSettled).toBe(false);

    gate.resolve();
    await syncing;
    await purging;
    // Purge won even though a read-then-write sync raced it: the drained set
    // landed first, then the purge scan removed it — nothing resurrected.
    expect(await s.allMeals()).toEqual([]);
  });

  it("attempts every key and rejects (with a count) if the backing del fails", async () => {
    // A Kv whose del always rejects — purge must still ATTEMPT all keys (best-effort
    // total), then reject reporting the failure so the caller can surface it.
    let delAttempts = 0;
    const failingKv = new (class extends MemoryKv {
      override async del(): Promise<void> {
        delAttempts += 1;
        throw new Error("blocked");
      }
    })();
    const s = new DiaryStore(failingKv, "https://alice.example/#me");
    await seedEveryKind(s, "z");
    const keyCount = (await failingKv.keys(`${encodeURIComponent("https://alice.example/#me")}|`)).length;
    expect(keyCount).toBeGreaterThan(0);
    await expect(s.purge()).rejects.toThrow(/failed to delete/);
    // allSettled ⇒ every key's del was attempted, not aborted on the first failure.
    expect(delAttempts).toBe(keyCount);
  });
});
