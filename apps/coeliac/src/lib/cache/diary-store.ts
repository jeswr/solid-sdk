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
import type {
  Confidence,
  ExposureData,
  FoodItemData,
  MealContext,
  Portion,
  ProtocolPhase,
  SymptomType,
  TriggerSlug,
  Verdict,
} from "@jeswr/solid-health-diary";
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

/**
 * An elimination protocol as cached locally (Phase 2B). Unlike append-only
 * meals/symptoms, a protocol is a SINGLE resource UPDATED in place across its
 * lifetime (same `ulid`/`url` on every phase transition — the pod PUT overwrites
 * it). Dates are ISO strings.
 */
export interface StoredProtocol {
  readonly kind: "protocol";
  ulid: string;
  url: string;
  targetTrigger: TriggerSlug;
  phase: ProtocolPhase;
  phaseStarted?: string;
  phasePlannedEnd?: string;
  challengeStep?: number;
  patient?: string;
  /** `dcterms:created` — when the protocol was first started (stable). */
  createdAt: string;
  /** Local bookkeeping — when the record was last written (newest wins on merge). */
  updatedAt: string;
  sync: SyncState;
  error?: string;
}

/**
 * A tolerance conclusion as cached locally (Phase 2B) — minted ONLY from a
 * concluded protocol (the sole `confirmed` path). Dates are ISO strings.
 */
export interface StoredConclusion {
  readonly kind: "conclusion";
  ulid: string;
  url: string;
  aboutTrigger: TriggerSlug;
  verdict: Verdict;
  /** Always `confirmed` here (a conclusion only exists from a completed protocol). */
  confidence: Confidence;
  note?: string;
  /** `diet:reviewAfter` re-challenge date (time-boxed secondary intolerances). */
  reviewAfter?: string;
  patient?: string;
  derivedFrom?: string[];
  /** The protocol (`ulid`) that produced this conclusion. */
  protocolUlid?: string;
  createdAt: string;
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

  private prefix(kind: "meal" | "symptom" | "protocol" | "conclusion"): string {
    return `${encodeURIComponent(this.scope)}|${kind}|`;
  }
  private key(kind: "meal" | "symptom" | "protocol" | "conclusion", ulid: string): string {
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

  // --- protocols (Phase 2B) — updated in place across the lifetime -------------

  async putProtocol(protocol: StoredProtocol): Promise<void> {
    await this.kv.set(this.key("protocol", protocol.ulid), protocol);
  }
  async getProtocol(ulid: string): Promise<StoredProtocol | undefined> {
    return (await this.kv.get<StoredProtocol>(this.key("protocol", ulid))) ?? undefined;
  }
  /** All protocols, newest-created first. */
  async allProtocols(): Promise<StoredProtocol[]> {
    const keys = await this.kv.keys(this.prefix("protocol"));
    const items = await Promise.all(keys.map((k) => this.kv.get<StoredProtocol>(k)));
    return items
      .filter((p): p is StoredProtocol => !!p)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async markProtocolSync(ulid: string, sync: SyncState, error?: string): Promise<void> {
    const p = await this.kv.get<StoredProtocol>(this.key("protocol", ulid));
    if (!p) return;
    p.sync = sync;
    p.error = sync === "error" ? error : undefined;
    await this.kv.set(this.key("protocol", ulid), p);
  }

  // --- conclusions (Phase 2B) --------------------------------------------------

  async putConclusion(conclusion: StoredConclusion): Promise<void> {
    await this.kv.set(this.key("conclusion", conclusion.ulid), conclusion);
  }
  /** All conclusions, newest-created first. */
  async allConclusions(): Promise<StoredConclusion[]> {
    const keys = await this.kv.keys(this.prefix("conclusion"));
    const items = await Promise.all(keys.map((k) => this.kv.get<StoredConclusion>(k)));
    return items
      .filter((c): c is StoredConclusion => !!c)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async markConclusionSync(ulid: string, sync: SyncState, error?: string): Promise<void> {
    const c = await this.kv.get<StoredConclusion>(this.key("conclusion", ulid));
    if (!c) return;
    c.sync = sync;
    c.error = sync === "error" ? error : undefined;
    await this.kv.set(this.key("conclusion", ulid), c);
  }

  /** Records still needing a pod write (pending or errored). */
  async pending(): Promise<{
    meals: StoredMeal[];
    symptoms: StoredSymptom[];
    protocols: StoredProtocol[];
    conclusions: StoredConclusion[];
  }> {
    const [meals, symptoms, protocols, conclusions] = await Promise.all([
      this.allMeals(),
      this.allSymptoms(),
      this.allProtocols(),
      this.allConclusions(),
    ]);
    return {
      meals: meals.filter((m) => m.sync !== "synced"),
      symptoms: symptoms.filter((s) => s.sync !== "synced"),
      protocols: protocols.filter((p) => p.sync !== "synced"),
      conclusions: conclusions.filter((c) => c.sync !== "synced"),
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
