// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import { newMealRecord, newSymptomRecord } from "../diary/log";
import { DiaryStore, mealLabel, mealSignature } from "./diary-store";
import { MemoryKv } from "./kv";

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
