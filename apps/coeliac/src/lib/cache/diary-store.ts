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
  CoeliacGeneticRisk,
  Confidence,
  ExposureData,
  FoodItemData,
  GeneticSourceType,
  HlaMarkerData,
  MealContext,
  Portion,
  ProtocolPhase,
  SymptomType,
  TriggerSlug,
  Verdict,
} from "@jeswr/solid-health-diary";
import type { Kv } from "./kv";

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

/**
 * The interpreted genetic summary as cached locally (Phase 3c). PRIVACY-CRITICAL,
 * and — like a protocol — a SINGLE latest-state record (one per pod, `summary.ttl`,
 * overwritten in place). Holds ONLY the interpreted markers + framing + rollup;
 * there is by construction NO field for raw genotype bytes (the raw file is parsed
 * on-device and discarded). `consentGiven` is cached so the UI can reflect the
 * consented state offline, and is always `true` here (a summary is never created
 * without consent).
 */
export interface StoredGeneticSummary {
  readonly kind: "genetic";
  /** The pod resource URL (`…/genetics/summary.ttl`). */
  url: string;
  /** The interpreted HLA marker rows (summary only — never raw bytes). */
  markers: HlaMarkerData[];
  /** The mandatory negative-predictive framing (`diet:geneticInterpretation`). */
  interpretation: string;
  /** The NPV-only rollup (`risk-haplotype-present`/`-absent`/`partial-coverage`/`indeterminate`). */
  coeliacGeneticRisk?: CoeliacGeneticRisk;
  /** Was every primary risk tag SNP definitively called? Drives the NPV-absent gate. */
  coverageComplete?: boolean;
  /** Provenance WITHOUT raw data (`manual`/`consumer-array`/`clinical-report`). */
  sourceType?: GeneticSourceType;
  /** Always `true` — a genetic summary is never cached/written without explicit consent. */
  consentGiven: true;
  createdAt: string;
  /**
   * A unique per-write revision token (collision-proof, unlike a ms timestamp). Used
   * ONLY as the sync-completion discriminator: an in-flight write settling against a
   * DIFFERENT `rev` (a newer summary replaced it) is ignored, so a newer unsaved
   * record is never wrongly flipped to `synced`.
   */
  rev: string;
  sync: SyncState;
  error?: string;
}

/**
 * A per-user trigger lag profile as cached locally (Brief follow-up to Phase 4B —
 * the Insights richer-UI work). Mirrors `diet:TriggerClass`
 * ({@link import("@jeswr/solid-health-diary").TriggerClassData}), but is a LOCALLY
 * LEARNED refinement of the model's evidence-prior lag window (`lag.ts`
 * `resolveLag` prefers this over the prior when it validates) — it is derived
 * on-device from the user's own logged exposure/symptom pairings
 * ({@link "../inference/learn-lag-profile"}), never fetched or written to the pod.
 * A SINGLE latest-state record per trigger (like a protocol, overwritten in place
 * as more evidence accumulates), keyed by `slug`.
 */
export interface StoredTriggerClass {
  readonly kind: "triggerClass";
  slug: TriggerSlug;
  lagWindowMin: number;
  lagWindowMax: number;
  lagMode: number;
  label?: string;
  /** How many evidence pairings the learned profile rests on (transparency, never hidden). */
  sampleSize: number;
  /** When this profile was last (re)learned. */
  updatedAt: string;
}

/**
 * The caller-supplied safety signals ({@link import("../inference/types").SafetyContext})
 * as cached locally — a SINGLE latest-state record (like the genetic summary), so
 * the Insights safety-context inputs (alarm checklist, confirmed-coeliac toggle,
 * strict-adherence toggle) persist across visits instead of resetting to the
 * always-safe defaults every reload. Mirrors the engine's `SafetyContext` shape
 * exactly (never a superset) — this cache module stores it structurally without
 * depending on the inference layer's types.
 */
export interface StoredSafetyContext {
  readonly kind: "safetyContext";
  coeliacDiagnosed?: boolean;
  alarmFlags?: {
    unintendedWeightLoss?: boolean;
    giBleeding?: boolean;
    persistentVomiting?: boolean;
    dysphagia?: boolean;
    anaemia?: boolean;
  };
  strictAdherence?: boolean;
  updatedAt: string;
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
  /**
   * Set the instant {@link purge} is CALLED (synchronously, before its own
   * async work) — see {@link isPurged}. This is the store-level half of the
   * session-race guard (`session/use-insights.ts`): a caller holding a
   * reference to THIS store instance can synchronously check whether the
   * account it belongs to has departed, without depending on any React
   * re-render/effect timing (which cannot be trusted to run before a
   * concurrently in-flight `await` continuation resumes — a roborev finding
   * against an earlier ref-based attempt at this same guard).
   */
  private purged = false;

  /**
   * In-flight FIRE-AND-FORGET background writes {@link purge} must DRAIN
   * before its own delete scan (roborev round 3): checking {@link isPurged}
   * at the top of a write only closes the race for a write that starts
   * AFTER `purge()` flips the flag. A write already past that check when
   * `purge()` is called is still in flight — if `purge()`'s scan+delete ran
   * immediately, that write's `kv.set` could land AFTER the delete and
   * resurrect the key. `purge()` awaits every write registered here before
   * scanning, so a write already under way is guaranteed to settle first.
   * Only the two BACKGROUND, unawaited-by-their-caller writers register here
   * (`putTriggerClass`/`putSafetyContext` — `useInsights`/
   * `useSafetyContextCache` both fire them without awaiting, by design, so
   * they can't block the paint); every other write method here is always
   * awaited by its own caller before that caller does anything else, so
   * there is no OTHER dangling write for a purge to race today.
   */
  private readonly pendingWrites = new Set<Promise<unknown>>();

  constructor(
    private readonly kv: Kv,
    /** WebID (or another per-account key) — namespaces all keys. */
    private readonly scope: string,
  ) {}

  /**
   * Whether the mandatory logout privacy {@link purge} has been called (or is
   * in progress) on THIS store instance. A caller with a background write in
   * flight (e.g. `useInsights`'s learned-trigger-class persist) must check
   * this BEFORE writing and abandon the write if `true` — a purge in progress
   * must never be silently undone by a stale, unrelated write racing it.
   */
  isPurged(): boolean {
    return this.purged;
  }

  /**
   * Register a background write's promise so {@link purge} can wait for it
   * to settle before scanning+deleting (see {@link pendingWrites}). Called
   * SYNCHRONOUSLY, before the write's own `await` — so if `purge()` has not
   * yet been called, this registration is guaranteed to land before it could
   * be (JS run-to-completion: nothing yields between the caller's `isPurged`
   * check and this call).
   */
  private trackWrite(write: Promise<unknown>): Promise<unknown> {
    this.pendingWrites.add(write);
    const untrack = () => this.pendingWrites.delete(write);
    write.then(untrack, untrack);
    return write;
  }

  /**
   * The scope-wide key prefix covering EVERY kind for this account's WebID. The
   * trailing `|` delimiter — which `encodeURIComponent` never emits (it escapes
   * `|` to `%7C`) — makes this an exact, collision-free scope boundary: one
   * account's prefix can never be a prefix of another's, even when one encoded
   * WebID is a textual prefix of another (proven by the purge cross-scope test).
   */
  private scopePrefix(): string {
    return `${encodeURIComponent(this.scope)}|`;
  }
  private prefix(
    kind: "meal" | "symptom" | "protocol" | "conclusion" | "genetic" | "triggerClass" | "safetyContext",
  ): string {
    return `${this.scopePrefix()}${kind}|`;
  }
  private key(
    kind: "meal" | "symptom" | "protocol" | "conclusion" | "genetic" | "triggerClass" | "safetyContext",
    ulid: string,
  ): string {
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

  /**
   * Whether ANY cached meal carries the given context (e.g. `restaurant`). Scans
   * the FULL meal cache — deliberately NOT `recentMeals()`, which caps at a limit
   * and dedupes by signature, so a restaurant meal outside the recent window, or
   * one sharing a signature with a newer non-restaurant meal, would be missed
   * (Phase-4A eating-out surfacing must not lose an eating-out signal). Cache-only,
   * no network; returns a bare boolean so no meal detail is exposed to the caller.
   */
  async hasMealContext(context: MealContext): Promise<boolean> {
    for (const meal of await this.allMeals()) {
      if (meal.context === context) return true;
    }
    return false;
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

  // --- genetics (Phase 3c) — a SINGLE latest-state record, most-sensitive --------

  /** The fixed cache id for the one genetic summary (there is exactly one per pod). */
  private static readonly GENETIC_ID = "summary";

  async putGeneticSummary(summary: StoredGeneticSummary): Promise<void> {
    await this.kv.set(this.key("genetic", DiaryStore.GENETIC_ID), summary);
  }
  async getGeneticSummary(): Promise<StoredGeneticSummary | undefined> {
    return (
      (await this.kv.get<StoredGeneticSummary>(this.key("genetic", DiaryStore.GENETIC_ID))) ??
      undefined
    );
  }
  /** Delete the cached genetic summary (e.g. on an explicit user-initiated removal). */
  async deleteGeneticSummary(): Promise<void> {
    await this.kv.del(this.key("genetic", DiaryStore.GENETIC_ID));
  }
  /**
   * Mark the sync state of the genetic summary — but ONLY if the stored record is
   * still the SAME one whose write settled (`expectedCreatedAt` discriminator). If a
   * newer summary replaced it while the older write was in flight, the stale
   * completion is IGNORED, so the newer record is never wrongly flipped to `synced`
   * (which would drop it from the outbox and lose an unsaved genetic summary). Each
   * `rev` is a unique per-save token, so it uniquely identifies the record flushed.
   */
  async markGeneticSync(expectedRev: string, sync: SyncState, error?: string): Promise<void> {
    const g = await this.kv.get<StoredGeneticSummary>(this.key("genetic", DiaryStore.GENETIC_ID));
    if (!g || g.rev !== expectedRev) return; // replaced in flight — ignore the stale completion
    g.sync = sync;
    g.error = sync === "error" ? error : undefined;
    await this.kv.set(this.key("genetic", DiaryStore.GENETIC_ID), g);
  }

  // --- learned trigger lag profiles (Insights richer-UI follow-up) -------------

  /**
   * Store (or overwrite in place) a locally-learned per-trigger lag profile.
   * ONE record per `slug` — a re-learn simply replaces the prior estimate, same
   * as a protocol's in-place update.
   *
   * FAIL-CLOSED + DRAINED (roborev, session-race guard round 3): a caller
   * (`useInsights`) fires this WITHOUT awaiting it, so a logout's `purge()`
   * can be called concurrently. `isPurged()` short-circuits a write that
   * starts AFTER the account has departed; {@link trackWrite} registers a
   * write already under way so `purge()` waits for it to settle before its
   * own scan+delete — together these close the race in both directions.
   */
  async putTriggerClass(triggerClass: StoredTriggerClass): Promise<void> {
    if (this.purged) return;
    await this.trackWrite(this.kv.set(this.key("triggerClass", triggerClass.slug), triggerClass));
  }
  /** All locally-learned trigger classes for this account. */
  async allTriggerClasses(): Promise<StoredTriggerClass[]> {
    const keys = await this.kv.keys(this.prefix("triggerClass"));
    const items = await Promise.all(keys.map((k) => this.kv.get<StoredTriggerClass>(k)));
    return items.filter((t): t is StoredTriggerClass => !!t);
  }

  // --- safety-context inputs (Insights richer-UI follow-up) --------------------

  /** The fixed cache id for the one safety-context record (there is exactly one per pod). */
  private static readonly SAFETY_CONTEXT_ID = "current";

  /**
   * Persist the current safety-context inputs (alarm flags / diagnosed /
   * adherence). FAIL-CLOSED + DRAINED, same discipline as
   * {@link putTriggerClass} — the checkbox `onChange` handlers
   * (`SafetyContextForm`) fire this without awaiting it either.
   */
  async putSafetyContext(ctx: StoredSafetyContext): Promise<void> {
    if (this.purged) return;
    await this.trackWrite(this.kv.set(this.key("safetyContext", DiaryStore.SAFETY_CONTEXT_ID), ctx));
  }
  /** Read back the persisted safety-context inputs, if any were ever saved. */
  async getSafetyContext(): Promise<StoredSafetyContext | undefined> {
    return (
      (await this.kv.get<StoredSafetyContext>(
        this.key("safetyContext", DiaryStore.SAFETY_CONTEXT_ID),
      )) ?? undefined
    );
  }

  /** Records still needing a pod write (pending or errored). */
  async pending(): Promise<{
    meals: StoredMeal[];
    symptoms: StoredSymptom[];
    protocols: StoredProtocol[];
    conclusions: StoredConclusion[];
    genetics: StoredGeneticSummary[];
  }> {
    const [meals, symptoms, protocols, conclusions, genetic] = await Promise.all([
      this.allMeals(),
      this.allSymptoms(),
      this.allProtocols(),
      this.allConclusions(),
      this.getGeneticSummary(),
    ]);
    return {
      meals: meals.filter((m) => m.sync !== "synced"),
      symptoms: symptoms.filter((s) => s.sync !== "synced"),
      protocols: protocols.filter((p) => p.sync !== "synced"),
      conclusions: conclusions.filter((c) => c.sync !== "synced"),
      genetics: genetic && genetic.sync !== "synced" ? [genetic] : [],
    };
  }

  /**
   * PRIVACY PURGE — mandatory on sign-out (the offline design's §7 logout-purge,
   * parallel to the credential wipe). Delete EVERY cached record for THIS account's
   * WebID scope from the backing Kv — meals, symptoms, protocols, conclusions, the
   * genetic summary, the locally-learned trigger lag profiles, and the
   * safety-context inputs alike, pending or synced — so nothing the now-departed
   * user logged or read is recoverable by the next user of the same browser/device.
   * New record kinds are covered by CONSTRUCTION, not by an enumerated list: every
   * kind is namespaced under this same `|`-delimited {@link scopePrefix}
   * (see {@link key}), and purge deletes by prefix scan — so a kind added later
   * (like `triggerClass`/`safetyContext`) is swept automatically without this
   * method needing an update, as long as it goes through {@link key}/{@link prefix}.
   *
   * Purge is exact and isolated: it only touches keys under this scope's
   * `|`-delimited {@link scopePrefix}, so a DIFFERENT WebID's cache (and the
   * anonymous cache) is never affected. It is best-effort but TOTAL — every
   * deletable key is attempted even if one `del` fails — and rejects (reporting how
   * many keys could not be deleted) only if the backing store itself failed on some
   * keys, so a caller can surface an incomplete purge rather than silently assume
   * success.
   *
   * This operates ONLY on the app's IndexedDB Kv. It deliberately does NOT — and
   * must never — reach into the Cache API: private pod/health data is never written
   * there (the shell-only service-worker boundary), so there is nothing to purge
   * from it.
   *
   * Marks {@link isPurged} `true` as the FIRST synchronous statement — before any
   * `await` — so a concurrent background writer that checks it (even one already
   * mid-flight) sees the departure as soon as `purge()` is called, not only once
   * it finishes. Then DRAINS {@link pendingWrites} (roborev round 3): a
   * background write that had ALREADY passed its own `isPurged()` check before
   * this line ran is still in flight — waiting for it to settle here guarantees
   * its `kv.set` cannot land AFTER the delete scan below and resurrect a key.
   */
  async purge(): Promise<void> {
    this.purged = true;
    await Promise.allSettled([...this.pendingWrites]);
    const keys = await this.kv.keys(this.scopePrefix());
    const results = await Promise.allSettled(keys.map((k) => this.kv.del(k)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      throw new Error(`DiaryStore.purge: ${failed}/${keys.length} key(s) failed to delete`);
    }
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
