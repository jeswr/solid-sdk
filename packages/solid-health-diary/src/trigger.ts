// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
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

import type { DatasetCore, Literal, DataFactory as RdfDataFactory } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { storeToTurtle } from "./serialize.js";
import { setIfDefined, tryRead } from "./util.js";
import {
  DIET_TRIGGER_CLASS,
  diet,
  isTriggerSlug,
  rdf,
  SKOS_CONCEPT,
  skos,
  type TriggerSlug,
  triggerIri,
  triggerSlugFromIri,
} from "./vocab.js";

const XSD_DECIMAL = "http://www.w3.org/2001/XMLSchema#decimal";

/**
 * Format a finite number as a PLAIN `xsd:decimal` lexical — never exponent notation
 * (`1e21` / `1e-7`), which `String(value)` produces for extreme magnitudes and which
 * is NOT a legal `xsd:decimal` form even though the datatype says decimal. Expands
 * JS scientific notation into a plain `[-]digits[.digits]` string.
 */
export function toXsdDecimalLexical(value: number): string {
  const s = String(value);
  if (!/[eE]/.test(s)) return s;
  const neg = value < 0;
  const [coeff = "0", expStr = "0"] = Math.abs(value).toExponential().split("e");
  const exp = Number(expStr);
  const [intDigits = "", fracDigits = ""] = coeff.split(".");
  const digits = intDigits + fracDigits;
  const pointPos = intDigits.length + exp; // decimal-point index within `digits`
  let out: string;
  if (pointPos <= 0) {
    out = `0.${"0".repeat(-pointPos)}${digits}`;
  } else if (pointPos >= digits.length) {
    out = digits + "0".repeat(pointPos - digits.length);
  } else {
    out = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
  }
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return neg ? `-${out}` : out;
}

/**
 * A `@rdfjs/wrapper` "from" mapper writing a lag-hours number as an `xsd:decimal`
 * literal. The vendored vocab declares `diet:lagWindowMin`/`lagWindowMax`/`lagMode`
 * as `rdfs:range xsd:decimal`; `LiteralFrom.double` would stamp `xsd:double` and
 * drift from the ontology contract. {@link toXsdDecimalLexical} guarantees a plain
 * (exponent-free) lexical even for an extreme magnitude.
 */
function decimalFrom(value: number, factory: RdfDataFactory): Literal {
  return factory.literal(toXsdDecimalLexical(value), factory.namedNode(XSD_DECIMAL));
}

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
export function isValidLagProfile(p: LagProfile): boolean {
  const { lagWindowMin: min, lagWindowMax: max, lagMode: mode } = p;
  return (
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    Number.isFinite(mode) &&
    min >= 0 &&
    mode >= min &&
    max >= mode
  );
}

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
export const EVIDENCE_PRIOR_LAG: Readonly<Record<TriggerSlug, LagProfile>> = {
  gluten: { lagWindowMin: 0, lagWindowMax: 72, lagMode: 3 },
  lactose: { lagWindowMin: 0.5, lagWindowMax: 6, lagMode: 2 },
  fructose: { lagWindowMin: 0.5, lagWindowMax: 24, lagMode: 4 },
  fructan: { lagWindowMin: 0.5, lagWindowMax: 24, lagMode: 6 },
  galactan: { lagWindowMin: 0.5, lagWindowMax: 24, lagMode: 6 },
  polyol: { lagWindowMin: 0.5, lagWindowMax: 24, lagMode: 4 },
  sulphites: { lagWindowMin: 0.25, lagWindowMax: 6, lagMode: 1 },
  histamine: { lagWindowMin: 0.25, lagWindowMax: 4, lagMode: 1 },
  nuts: { lagWindowMin: 0, lagWindowMax: 6, lagMode: 1 },
  soy: { lagWindowMin: 0, lagWindowMax: 8, lagMode: 2 },
  egg: { lagWindowMin: 0, lagWindowMax: 6, lagMode: 1 },
  caffeine: { lagWindowMin: 0.25, lagWindowMax: 6, lagMode: 1 },
};

/**
 * The evidence-prior {@link TriggerClassData} for a trigger slug — the seeded
 * default before any per-user learning.
 */
export function defaultTriggerClass(slug: TriggerSlug): TriggerClassData {
  return { slug, label: slug, ...EVIDENCE_PRIOR_LAG[slug] };
}

/**
 * Typed `@rdfjs/wrapper` view of a `diet:TriggerClass` subject. Construct it on
 * the concept IRI (`diet:{slug}`).
 */
export class TriggerClass extends TermWrapper {
  /** The concept IRI. */
  get id(): string {
    return this.value;
  }

  /** The `rdf:type` set as a live set of IRI strings. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp as a `diet:TriggerClass` + `skos:Concept`. Idempotent; returns `this`. */
  mark(): this {
    this.types.add(DIET_TRIGGER_CLASS);
    this.types.add(SKOS_CONCEPT);
    return this;
  }

  /** Whether this subject is a `diet:TriggerClass`. */
  get isTriggerClass(): boolean {
    return this.types.has(DIET_TRIGGER_CLASS);
  }

  /** `skos:prefLabel`. */
  get label(): string | undefined {
    return OptionalFrom.subjectPredicate(this, skos("prefLabel"), LiteralAs.string);
  }
  set label(value: string | undefined) {
    OptionalAs.object(this, skos("prefLabel"), value, LiteralFrom.string);
  }

  /** `diet:lagWindowMin` — earliest plausible onset, hours. */
  get lagWindowMin(): number | undefined {
    return OptionalFrom.subjectPredicate(this, diet("lagWindowMin"), LiteralAs.number);
  }
  set lagWindowMin(value: number | undefined) {
    OptionalAs.object(this, diet("lagWindowMin"), value, decimalFrom);
  }

  /** `diet:lagWindowMax` — latest plausible onset, hours. */
  get lagWindowMax(): number | undefined {
    return OptionalFrom.subjectPredicate(this, diet("lagWindowMax"), LiteralAs.number);
  }
  set lagWindowMax(value: number | undefined) {
    OptionalAs.object(this, diet("lagWindowMax"), value, decimalFrom);
  }

  /** `diet:lagMode` — the modal lag, hours. */
  get lagMode(): number | undefined {
    return OptionalFrom.subjectPredicate(this, diet("lagMode"), LiteralAs.number);
  }
  set lagMode(value: number | undefined) {
    OptionalAs.object(this, diet("lagMode"), value, decimalFrom);
  }
}

/** The subject IRI of a trigger class — its `diet:{slug}` concept IRI. */
export function triggerClassSubject(slug: TriggerSlug): string {
  return triggerIri(slug);
}

/**
 * Parse a `diet:TriggerClass` out of a dataset, or `undefined` if the subject at
 * `diet:{slug}` is not a `diet:TriggerClass`. Missing lag values fall back to the
 * evidence prior.
 */
export function parseTriggerClass(
  slug: TriggerSlug,
  dataset: DatasetCore,
): TriggerClassData | undefined {
  return tryRead(() => parseTriggerClassImpl(slug, dataset));
}
function parseTriggerClassImpl(
  slug: TriggerSlug,
  dataset: DatasetCore,
): TriggerClassData | undefined {
  const doc = new TriggerClass(triggerClassSubject(slug), dataset, DataFactory);
  if (!doc.isTriggerClass) return undefined;
  // (A TriggerClass has NO sh:maxCount 1 scalar field in the vendored SHACL — the lag
  // values are unconstrained and skos:prefLabel is per-language — so no singleton
  // guard applies; the accessors' first-match read is the deterministic choice.)
  const prior = EVIDENCE_PRIOR_LAG[slug];
  // Per-field fallback to the evidence prior for a missing value, THEN a whole-profile
  // sanity gate: if the resulting profile is not finite / non-negative / ordered (a
  // hostile or garbled document could carry NaN/Infinity/negative/unordered lag
  // values), discard it entirely and fall back to the trusted evidence prior rather
  // than surface a profile that would corrupt lag attribution.
  const candidate: LagProfile = {
    lagWindowMin: doc.lagWindowMin ?? prior.lagWindowMin,
    lagWindowMax: doc.lagWindowMax ?? prior.lagWindowMax,
    lagMode: doc.lagMode ?? prior.lagMode,
  };
  const lag = isValidLagProfile(candidate) ? candidate : prior;
  const data: TriggerClassData = { slug, ...lag };
  setIfDefined(data, "label", doc.label);
  return data;
}

/**
 * Build a fresh n3 `Store` holding one `diet:TriggerClass` rooted at
 * `diet:{slug}`. Reuses {@link TriggerClass} — never hand-built triples.
 */
export function buildTriggerClass(data: TriggerClassData): Store {
  // Fail-closed: the slug must be a KNOWN trigger — `triggerIri` does not validate,
  // so a bad cast could otherwise mint a `diet:undefined`/`diet:<bad>` subject that
  // no trigger helper can round-trip.
  if (!isTriggerSlug(data.slug)) {
    throw new Error(
      `buildTriggerClass: slug must be a known TriggerClass — got ${JSON.stringify(data.slug)}.`,
    );
  }
  // Fail-closed: refuse to serialise a lag profile that is not finite, non-negative,
  // and ordered (min ≤ mode ≤ max) — it drives every lag attribution.
  if (!isValidLagProfile(data)) {
    throw new Error(
      `buildTriggerClass: lag profile must be finite, non-negative and ordered ` +
        `(lagWindowMin ≤ lagMode ≤ lagWindowMax) — got ${JSON.stringify({
          lagWindowMin: data.lagWindowMin,
          lagMode: data.lagMode,
          lagWindowMax: data.lagWindowMax,
        })}.`,
    );
  }
  const store = new Store();
  const doc = new TriggerClass(triggerClassSubject(data.slug), store, DataFactory).mark();
  doc.label = data.label ?? data.slug;
  doc.lagWindowMin = data.lagWindowMin;
  doc.lagWindowMax = data.lagWindowMax;
  doc.lagMode = data.lagMode;
  return store;
}

/** Serialise a trigger class to Turtle (via `n3.Writer`, with the model's prefixes). */
export function serializeTriggerClass(data: TriggerClassData): Promise<string> {
  return storeToTurtle(buildTriggerClass(data));
}

/**
 * Build the per-user `triggers.ttl` document holding ALL evidence-prior trigger
 * classes (the DESIGN §2.3 `/health/diary/triggers.ttl` seed). One store, one
 * concept per slug.
 */
export function buildTriggerScheme(
  overrides: Partial<Record<TriggerSlug, Partial<LagProfile & { label: string }>>> = {},
): Store {
  const store = new Store();
  for (const slug of Object.keys(EVIDENCE_PRIOR_LAG) as TriggerSlug[]) {
    const base = defaultTriggerClass(slug);
    const doc = new TriggerClass(triggerClassSubject(slug), store, DataFactory).mark();
    const o = overrides[slug] ?? {};
    const merged: LagProfile = {
      lagWindowMin: o.lagWindowMin ?? base.lagWindowMin,
      lagWindowMax: o.lagWindowMax ?? base.lagWindowMax,
      lagMode: o.lagMode ?? base.lagMode,
    };
    // Fail-closed: an override must not break the finite/non-negative/ordered
    // invariant of the merged profile.
    if (!isValidLagProfile(merged)) {
      throw new Error(
        `buildTriggerScheme: the override for "${slug}" yields an invalid lag profile ` +
          `(must be finite, non-negative and ordered) — got ${JSON.stringify(merged)}.`,
      );
    }
    doc.label = o.label ?? base.label;
    doc.lagWindowMin = merged.lagWindowMin;
    doc.lagWindowMax = merged.lagWindowMax;
    doc.lagMode = merged.lagMode;
  }
  return store;
}

/** Re-export the slug↔IRI helpers for convenience alongside the accessor. */
export { triggerIri, triggerSlugFromIri };
