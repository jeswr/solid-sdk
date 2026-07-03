// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The durable client cache + optimistic-write OUTBOX for the diary (DESIGN §5.3,
 * UX invariants #2/#3). Every logged meal/symptom lands here FIRST (optimistic,
 * instant), marked `pending`, then a reconcile pass flushes the outbox to the pod
 * and flips records to `synced` (or `error`, retried on the next flush). The home
 * screen paints instantly from this cache — never a blank load — and logging works
 * fully offline, syncing on reconnect.
 *
 * All state lives in an injected {@link Kv}, so this whole layer is unit-testable
 * with an in-memory store and no browser. Records are namespaced by WebID scope so
 * one account's data can never surface under another (the same-WebID isolation
 * rule). Dates are stored as ISO strings.
 */
import type { ExposureData, FoodItemData, MealContext, Portion, SymptomType } from "@jeswr/solid-health-diary";
import type { Kv } from "./kv.js";

/** The persistence/sync state of an optimistically-written record. */
export type SyncState = "pending" | "synced" | "error";

/** A meal as cached locally (serialisable; dates are ISO strings). */
export interface StoredMeal {
  readonly kind: "meal";
  ulid: string;
  url: string;
  startTime: string;
  createdAt: string;
  context?: MealContext;
  portion?: Portion;
  venue?: string;
  note?: string;
  items: FoodItemData[];
  exposures: ExposureData[];
  /** Grouping key for frequency + re-log dedupe (barcodes/names). */
  signature: string;
  /** Display label (joined item names). */
  label: string;
  sync: SyncState;
  error?: string;
}

/** A symptom as cached locally. */
export interface StoredSymptom {
  readonly kind: "symptom";
  ulid: string;
  url: string;
  symptomType: SymptomType;
  onset: string;
  createdAt: string;
  severity?: number;
  note?: string;
  sync: SyncState;
  error?: string;
}

/** A frequent-meal group for the one-tap re-log chips. */
export interface FrequentMeal {
  signature: string;
  label: string;
  count: number;
  latest: StoredMeal;
}

/** The signature grouping meals for frequency/dedupe: sorted barcodes-or-names. */
export function mealSignature(items: readonly FoodItemData[]): string {
  return items
    .map((i) => (i.offBarcode ? `b:${i.offBarcode}` : `n:${(i.name ?? "").trim().toLowerCase()}`))
    .filter((s) => s !== "n:")
    .sort()
    .join("|");
}

/** A human display label for a meal (joined item names, capped). */
export function mealLabel(items: readonly FoodItemData[]): string {
  const names = items.map((i) => i.name?.trim()).filter((n): n is string => !!n);
  if (names.length === 0) return "Meal";
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

export class DiaryStore {
  constructor(
    private readonly kv: Kv,
    /** WebID (or another per-account key) — namespaces all keys. */
    private readonly scope: string,
  ) {}

  private prefix(kind: "meal" | "symptom"): string {
    return `${encodeURIComponent(this.scope)}|${kind}|`;
  }
  private key(kind: "meal" | "symptom", ulid: string): string {
    return `${this.prefix(kind)}${ulid}`;
  }

  async putMeal(meal: StoredMeal): Promise<void> {
    await this.kv.set(this.key("meal", meal.ulid), meal);
  }
  async putSymptom(symptom: StoredSymptom): Promise<void> {
    await this.kv.set(this.key("symptom", symptom.ulid), symptom);
  }

  async allMeals(): Promise<StoredMeal[]> {
    const keys = await this.kv.keys(this.prefix("meal"));
    const meals = await Promise.all(keys.map((k) => this.kv.get<StoredMeal>(k)));
    return meals
      .filter((m): m is StoredMeal => !!m)
      .sort((a, b) => b.startTime.localeCompare(a.startTime));
  }
  async allSymptoms(): Promise<StoredSymptom[]> {
    const keys = await this.kv.keys(this.prefix("symptom"));
    const items = await Promise.all(keys.map((k) => this.kv.get<StoredSymptom>(k)));
    return items
      .filter((s): s is StoredSymptom => !!s)
      .sort((a, b) => b.onset.localeCompare(a.onset));
  }

  /** Recent meals for the home screen + re-log chips: newest first, one per signature. */
  async recentMeals(limit = 8): Promise<StoredMeal[]> {
    const seen = new Set<string>();
    const out: StoredMeal[] = [];
    for (const meal of await this.allMeals()) {
      if (meal.signature && seen.has(meal.signature)) continue;
      if (meal.signature) seen.add(meal.signature);
      out.push(meal);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Frequent meals: grouped by signature, most-logged first (the killer shortcut). */
  async frequentMeals(limit = 8): Promise<FrequentMeal[]> {
    const groups = new Map<string, FrequentMeal>();
    for (const meal of await this.allMeals()) {
      if (!meal.signature) continue;
      const g = groups.get(meal.signature);
      if (g) {
        g.count += 1;
        if (meal.startTime > g.latest.startTime) g.latest = meal;
      } else {
        groups.set(meal.signature, {
          signature: meal.signature,
          label: meal.label,
          count: 1,
          latest: meal,
        });
      }
    }
    return [...groups.values()]
      .sort((a, b) => b.count - a.count || b.latest.startTime.localeCompare(a.latest.startTime))
      .slice(0, limit);
  }

  /** Records still needing a pod write (pending or errored). */
  async pending(): Promise<{ meals: StoredMeal[]; symptoms: StoredSymptom[] }> {
    const [meals, symptoms] = await Promise.all([this.allMeals(), this.allSymptoms()]);
    return {
      meals: meals.filter((m) => m.sync !== "synced"),
      symptoms: symptoms.filter((s) => s.sync !== "synced"),
    };
  }

  async markMealSync(ulid: string, sync: SyncState, error?: string): Promise<void> {
    const meal = await this.kv.get<StoredMeal>(this.key("meal", ulid));
    if (!meal) return;
    meal.sync = sync;
    meal.error = sync === "error" ? error : undefined;
    await this.kv.set(this.key("meal", ulid), meal);
  }
  async markSymptomSync(ulid: string, sync: SyncState, error?: string): Promise<void> {
    const symptom = await this.kv.get<StoredSymptom>(this.key("symptom", ulid));
    if (!symptom) return;
    symptom.sync = sync;
    symptom.error = sync === "error" ? error : undefined;
    await this.kv.set(this.key("symptom", ulid), symptom);
  }
}
