/**
 * `diet:TriggerClass` — a trigger (gluten, lactose, sulphites, …) as a SKOS
 * concept carrying an **evidence-prior lag profile**.
 *
 * The lag profile is the single most load-bearing fact in the whole product
 * (coeliac-app DESIGN §4.1 / RESEARCH §2.1): symptom onset lags ingestion by a
 * trigger-specific interval, so a naive same-meal correlation systematically
 * mis-attributes. This module ships the literature **priors** — kept BYTE-FOR-BYTE
 * in step with the landed `diet:` ontology (`diet:lagWindowMin`/`lagWindowMax`/
 * `lagMode` on each trigger concept; `src/trigger.test.ts` cross-checks
 * `EVIDENCE_PRIOR_LAG` against the vendored `shapes/diet.vocab.ttl`). The inference
 * engine (Brief 2A) reads them; they become learnable per-user later.
 *
 * All three lag values are HOURS (`lagWindowMin`/`Max` the window bounds; `lagMode`
 * the modal/most-likely lag — a number, NOT a distribution-shape string).
 *
 * Typed accessors over an n3 `Store`, never hand-built triples (house rule).
 */
import type { DatasetCore } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { Store } from "n3";
import { type TriggerSlug, triggerIri, triggerSlugFromIri } from "./vocab.js";
/**
 * Format a finite number as a PLAIN `xsd:decimal` lexical — never exponent notation
 * (`1e21` / `1e-7`), which `String(value)` produces for extreme magnitudes and which
 * is NOT a legal `xsd:decimal` form even though the datatype says decimal. Expands
 * JS scientific notation into a plain `[-]digits[.digits]` string.
 */
export declare function toXsdDecimalLexical(value: number): string;
/** A trigger's evidence-prior lag profile — all three values in HOURS. */
export interface LagProfile {
    /** `diet:lagWindowMin` — earliest plausible onset after ingestion, hours. */
    lagWindowMin: number;
    /** `diet:lagWindowMax` — latest plausible onset after ingestion, hours. */
    lagWindowMax: number;
    /** `diet:lagMode` — the modal (peak / most-likely) lag, hours. */
    lagMode: number;
}
/**
 * A lag profile is SANE iff all three hour values are finite, non-negative, and
 * ORDERED (`lagWindowMin ≤ lagMode ≤ lagWindowMax`). The lag profile is the single
 * most load-bearing fact in the product (it drives every lag attribution), so a
 * `NaN`/`Infinity`/negative/unordered profile must never be surfaced or serialised:
 * {@link buildTriggerClass}/{@link buildTriggerScheme} refuse an invalid one
 * (fail-closed) and {@link parseTriggerClass} falls back to the trusted evidence
 * prior when an untrusted document supplies a broken profile.
 */
export declare function isValidLagProfile(p: LagProfile): boolean;
/** A trigger class as a plain, serialisable object. */
export interface TriggerClassData extends LagProfile {
    /** The canonical slug (`gluten`, `lactose`, …); the subject is `diet:{slug}`. */
    slug: TriggerSlug;
    /** `skos:prefLabel` — a human label (defaults to the slug). */
    label?: string;
}
/**
 * The **evidence-prior lag windows** (hours) — seeded from RESEARCH §2.1 and kept
 * IDENTICAL to the landed `diet:` ontology's per-trigger `diet:lagWindowMin`/
 * `lagWindowMax`/`lagMode` (Brief 1B, `shapes/diet.vocab.ttl`). Directly
 * evidence-sourced: gluten (wide, right-skewed 0–72 h, modal ~3 h), acute
 * lactose/sulphite/histamine (tight ~0.25–6 h), FODMAP subgroups (mid ~0.5–24 h).
 * All values are priors, learnable per-user once enough data exists.
 */
export declare const EVIDENCE_PRIOR_LAG: Readonly<Record<TriggerSlug, LagProfile>>;
/**
 * The evidence-prior {@link TriggerClassData} for a trigger slug — the seeded
 * default before any per-user learning.
 */
export declare function defaultTriggerClass(slug: TriggerSlug): TriggerClassData;
/**
 * Typed `@rdfjs/wrapper` view of a `diet:TriggerClass` subject. Construct it on
 * the concept IRI (`diet:{slug}`).
 */
export declare class TriggerClass extends TermWrapper {
    /** The concept IRI. */
    get id(): string;
    /** The `rdf:type` set as a live set of IRI strings. */
    get types(): Set<string>;
    /** Stamp as a `diet:TriggerClass` + `skos:Concept`. Idempotent; returns `this`. */
    mark(): this;
    /** Whether this subject is a `diet:TriggerClass`. */
    get isTriggerClass(): boolean;
    /** `skos:prefLabel`. */
    get label(): string | undefined;
    set label(value: string | undefined);
    /** `diet:lagWindowMin` — earliest plausible onset, hours. */
    get lagWindowMin(): number | undefined;
    set lagWindowMin(value: number | undefined);
    /** `diet:lagWindowMax` — latest plausible onset, hours. */
    get lagWindowMax(): number | undefined;
    set lagWindowMax(value: number | undefined);
    /** `diet:lagMode` — the modal lag, hours. */
    get lagMode(): number | undefined;
    set lagMode(value: number | undefined);
}
/** The subject IRI of a trigger class — its `diet:{slug}` concept IRI. */
export declare function triggerClassSubject(slug: TriggerSlug): string;
/**
 * Parse a `diet:TriggerClass` out of a dataset, or `undefined` if the subject at
 * `diet:{slug}` is not a `diet:TriggerClass`. Missing lag values fall back to the
 * evidence prior.
 */
export declare function parseTriggerClass(slug: TriggerSlug, dataset: DatasetCore): TriggerClassData | undefined;
/**
 * Build a fresh n3 `Store` holding one `diet:TriggerClass` rooted at
 * `diet:{slug}`. Reuses {@link TriggerClass} — never hand-built triples.
 */
export declare function buildTriggerClass(data: TriggerClassData): Store;
/** Serialise a trigger class to Turtle (via `n3.Writer`, with the model's prefixes). */
export declare function serializeTriggerClass(data: TriggerClassData): Promise<string>;
/**
 * Build the per-user `triggers.ttl` document holding ALL evidence-prior trigger
 * classes (the DESIGN §2.3 `/health/diary/triggers.ttl` seed). One store, one
 * concept per slug.
 */
export declare function buildTriggerScheme(overrides?: Partial<Record<TriggerSlug, Partial<LagProfile & {
    label: string;
}>>>): Store;
/** Re-export the slug↔IRI helpers for convenience alongside the accessor. */
export { triggerIri, triggerSlugFromIri };
//# sourceMappingURL=trigger.d.ts.map