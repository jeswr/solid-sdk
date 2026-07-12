// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `diet:ToleranceConclusion` (DESIGN §2.2 entity 7) + `diet:DietPlan` (entity 9).
 *
 * A ToleranceConclusion is a per-trigger verdict (one resource per trigger,
 * `conclusions/{trigger}.ttl`) carrying an ordinal confidence + a plain-language
 * string (**never a bare percentage** — DESIGN §4.2 anti-overclaim rule), the
 * evidence it rests on (`diet:derivedFrom`, tap-through), and — crucially — a
 * `diet:reviewAfter` date, because secondary intolerances are time-boxed and
 * re-testable (RESEARCH §2.2). `confirmed` (`diet:confirmedByOwnTest`) is reachable
 * ONLY via a completed protocol, never correlation alone (enforced by the
 * inference engine, Brief 2A — a cross-resource invariant the SHACL cannot check).
 *
 * A DietPlan is the current working exclusion set — "what am I avoiding and why":
 * `diet:excludes` names the excluded TriggerClasses; `diet:restsOn` names the
 * ToleranceConclusions those exclusions rest on (the landed 1B vocab models both
 * at the plan level, per `diet-examples.ttl`).
 *
 * The enum-valued fields (`verdict`, `confidence`, `aboutTrigger`, and each
 * `excludes` trigger) are stored as `diet:` concept IRIs. Typed accessors; never
 * hand-built triples.
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
import { confidenceCodec, verdictCodec } from "./concepts.js";
import { httpIriOrUndefined, isHttpIri } from "./iri.js";
import { assertSubjectSingletons } from "./rdfGuards.js";
import { parseBody, storeToTurtle } from "./serialize.js";
import { setIfDefined, tryRead, validDateOrUndefined } from "./util.js";
import {
  DIET_DERIVED_FROM,
  DIET_DIET_PLAN,
  DIET_RESTS_ON,
  DIET_TOLERANCE_CONCLUSION,
  dct,
  diet,
  HEALTH_PATIENT_PROP,
  isTriggerSlug,
  rdf,
  type TriggerSlug,
  triggerIri,
  triggerSlugFromIri,
} from "./vocab.js";

// --- ToleranceConclusion ------------------------------------------------------

/** A per-trigger tolerance verdict (DESIGN §2.2 entity 7). */
export type Verdict = (typeof verdictCodec.tokens)[number];
/** The known verdicts. */
export const VERDICTS: readonly Verdict[] = verdictCodec.tokens;

/**
 * Ordinal confidence (DESIGN §4.2). `confirmed` = "confirmed by your own test"
 * (`diet:confirmedByOwnTest`) — reachable ONLY via a completed elimination
 * protocol, never correlation alone. Stored as a concept IRI; the plain-language
 * string lives on `diet:note`.
 */
export type Confidence = (typeof confidenceCodec.tokens)[number];
/** The known confidence ordinals, weakest first. */
export const CONFIDENCE_LEVELS: readonly Confidence[] = confidenceCodec.tokens;

/** A tolerance conclusion (DESIGN §2.2 entity 7). */
export interface ToleranceConclusionData {
  /** Subject IRI (`${url}#it`); informational. */
  id?: string;
  /** `diet:aboutTrigger` — the TriggerClass this concludes about (required). */
  aboutTrigger: TriggerSlug;
  /** `diet:verdict` (required). */
  verdict: Verdict;
  /** `diet:confidence` — an ordinal (never a bare percentage). */
  confidence?: Confidence;
  /** `diet:note` — the plain-language confidence string ("a pattern in your data, not a diagnosis"). */
  note?: string;
  /** `diet:reviewAfter` — re-challenge date for time-boxed (secondary) intolerances. */
  reviewAfter?: Date;
  /** `diet:derivedFrom` — the exposures/symptoms/protocol this rests on (tap-through). */
  derivedFrom?: string[];
  /** `health:patient` — the pod-owner Patient/Person WebID. */
  patient?: string;
  /** `dcterms:created`. */
  created?: Date;
}

/** Sorted copy of a string set (stable array round-trip). */
function sortedStrings(set: Set<string>): string[] {
  return [...set].sort();
}

const XSD_DATE = "http://www.w3.org/2001/XMLSchema#date";

/**
 * A `@rdfjs/wrapper` "from" mapper that writes a Date as a DATE-ONLY
 * `xsd:date` literal (`YYYY-MM-DD`). `@rdfjs/wrapper`'s built-in `LiteralFrom.date`
 * writes `value.toISOString()` (a full timestamp) while stamping `xsd:date`, which
 * is an INVALID `xsd:date` lexical form; this mapper produces a valid one.
 *
 * **UTC-anchored, by contract, symmetric with the reader.** The calendar date is
 * taken in UTC (`getUTC*` / equivalently `toISOString().slice(0, 10)`) because the
 * `reviewAfter` GETTER reads it back via `LiteralAs.date` = `new Date("YYYY-MM-DD")`,
 * which parses a date-only string as UTC midnight. Writing UTC here makes the
 * round-trip EXACT (`serialize∘parse == identity`, proven by the round-trip test).
 * Deriving from LOCAL components instead (`getFullYear`/`getMonth`/`getDate`) would
 * DESYNC the two ends and break the round-trip for any non-UTC timezone. Callers
 * therefore treat `diet:reviewAfter` as a UTC calendar date (a calendar date, not
 * an instant), constructing it as `new Date("2027-01-02")` (UTC), not
 * `new Date(2027, 0, 2)` (local).
 */
function xsdDateFrom(value: Date, factory: RdfDataFactory): Literal {
  // Fail-closed: an Invalid Date would serialise as the malformed lexical
  // `NaN-NaN-NaN` typed `xsd:date`. Refuse it rather than persist invalid RDF.
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(
      `reviewAfter must be a valid Date for an xsd:date literal — got ${JSON.stringify(value)}.`,
    );
  }
  const y = String(value.getUTCFullYear()).padStart(4, "0");
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return factory.literal(`${y}-${m}-${d}`, factory.namedNode(XSD_DATE));
}

/** Typed `@rdfjs/wrapper` view of a `diet:ToleranceConclusion`. */
export class ToleranceConclusion extends TermWrapper {
  get id(): string {
    return this.value;
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(DIET_TOLERANCE_CONCLUSION);
    return this;
  }
  get isConclusion(): boolean {
    return this.types.has(DIET_TOLERANCE_CONCLUSION);
  }

  /** `diet:aboutTrigger` → `diet:{slug}`; read back as the slug. */
  get aboutTrigger(): TriggerSlug | undefined {
    return triggerSlugFromIri(
      OptionalFrom.subjectPredicate(this, diet("aboutTrigger"), NamedNodeAs.string) ?? "",
    );
  }
  set aboutTrigger(value: TriggerSlug | undefined) {
    OptionalAs.object(
      this,
      diet("aboutTrigger"),
      value ? triggerIri(value) : undefined,
      NamedNodeFrom.string,
    );
  }

  /** `diet:verdict` → `diet:{concept}`; read back as the friendly token. */
  get verdict(): Verdict | undefined {
    return verdictCodec.fromIri(
      OptionalFrom.subjectPredicate(this, diet("verdict"), NamedNodeAs.string),
    );
  }
  set verdict(value: Verdict | undefined) {
    OptionalAs.object(
      this,
      diet("verdict"),
      value ? verdictCodec.toIri(value) : undefined,
      NamedNodeFrom.string,
    );
  }

  /** `diet:confidence` → `diet:{concept}`; read back as the friendly token. */
  get confidence(): Confidence | undefined {
    return confidenceCodec.fromIri(
      OptionalFrom.subjectPredicate(this, diet("confidence"), NamedNodeAs.string),
    );
  }
  set confidence(value: Confidence | undefined) {
    OptionalAs.object(
      this,
      diet("confidence"),
      value ? confidenceCodec.toIri(value) : undefined,
      NamedNodeFrom.string,
    );
  }

  get note(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("note"), LiteralAs.string);
  }
  set note(value: string | undefined) {
    OptionalAs.object(this, diet("note"), value, LiteralFrom.string);
  }

  /** `diet:reviewAfter` — an `xsd:date`. */
  get reviewAfter(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, diet("reviewAfter"), LiteralAs.date);
  }
  set reviewAfter(value: Date | undefined) {
    // Date-only xsd:date lexical (YYYY-MM-DD) — NOT LiteralFrom.date, which emits
    // an invalid full-timestamp lexical for the xsd:date datatype.
    OptionalAs.object(this, diet("reviewAfter"), value, xsdDateFrom);
  }

  /** `diet:derivedFrom` — the evidence IRIs (live set; ⊑ `prov:wasDerivedFrom`). */
  get derivedFrom(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      DIET_DERIVED_FROM,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** `health:patient` — the pod-owner Patient/Person WebID. */
  get patient(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HEALTH_PATIENT_PROP, NamedNodeAs.string);
  }
  set patient(value: string | undefined) {
    OptionalAs.object(this, HEALTH_PATIENT_PROP, value, NamedNodeFrom.string);
  }

  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }
}

/** The conclusion subject IRI: `${url}#it`. */
export function conclusionSubject(url: string): string {
  return `${url}#it`;
}

/** The SHACL `sh:maxCount 1` predicates for a ToleranceConclusion (only these are guarded). */
const CONCLUSION_SINGLETONS: readonly string[] = [
  diet("aboutTrigger"),
  diet("verdict"),
  diet("confidence"),
  diet("reviewAfter"),
];

/** Parse a ToleranceConclusion out of a dataset, or `undefined`. */
export function parseToleranceConclusion(
  url: string,
  dataset: DatasetCore,
): ToleranceConclusionData | undefined {
  return tryRead(() => parseToleranceConclusionImpl(url, dataset));
}
function parseToleranceConclusionImpl(
  url: string,
  dataset: DatasetCore,
): ToleranceConclusionData | undefined {
  const doc = new ToleranceConclusion(conclusionSubject(url), dataset, DataFactory);
  if (!doc.isConclusion) return undefined;
  assertSubjectSingletons(dataset, conclusionSubject(url), CONCLUSION_SINGLETONS);
  const aboutTrigger = doc.aboutTrigger;
  const verdict = doc.verdict;
  if (!aboutTrigger || !verdict) return undefined;
  const data: ToleranceConclusionData = { id: conclusionSubject(url), aboutTrigger, verdict };
  setIfDefined(data, "confidence", doc.confidence);
  setIfDefined(data, "note", doc.note);
  setIfDefined(data, "reviewAfter", validDateOrUndefined(doc.reviewAfter));
  // URL-valued fields are http(s)-filtered on READ (symmetric with the writer) so
  // a hostile pod document can never surface a `javascript:`/`data:` IRI.
  setIfDefined(data, "patient", httpIriOrUndefined(doc.patient));
  setIfDefined(data, "created", validDateOrUndefined(doc.created));
  const from = sortedStrings(doc.derivedFrom).filter(isHttpIri);
  if (from.length) data.derivedFrom = from;
  return data;
}

/** Build a fresh n3 `Store` holding one ToleranceConclusion rooted at `${url}#it`. */
export function buildToleranceConclusion(url: string, data: ToleranceConclusionData): Store {
  // Fail-closed on the SHACL MUSTs (symmetric with parseToleranceConclusion, which
  // rejects a record missing either): a known aboutTrigger and a valid verdict. JS
  // callers / bad casts could smuggle a missing or non-canonical coded value.
  if (!data.aboutTrigger || !isTriggerSlug(data.aboutTrigger)) {
    throw new Error(
      `buildToleranceConclusion: aboutTrigger is REQUIRED and must be a known TriggerClass — got ${JSON.stringify(
        data.aboutTrigger,
      )}.`,
    );
  }
  if (!data.verdict || !verdictCodec.isToken(data.verdict)) {
    throw new Error(
      `buildToleranceConclusion: verdict is REQUIRED and must be a known verdict — got ${JSON.stringify(
        data.verdict,
      )}.`,
    );
  }
  const store = new Store();
  const doc = new ToleranceConclusion(conclusionSubject(url), store, DataFactory).mark();
  doc.aboutTrigger = data.aboutTrigger;
  doc.verdict = data.verdict;
  doc.confidence = data.confidence;
  doc.note = data.note;
  doc.reviewAfter = data.reviewAfter;
  doc.patient = httpIriOrUndefined(data.patient);
  doc.created = data.created ?? new Date();
  for (const iri of data.derivedFrom ?? []) if (isHttpIri(iri)) doc.derivedFrom.add(iri);
  return store;
}

/** Serialise a ToleranceConclusion to Turtle (via `n3.Writer`). */
export function serializeToleranceConclusion(
  url: string,
  data: ToleranceConclusionData,
): Promise<string> {
  return storeToTurtle(buildToleranceConclusion(url, data));
}

/** Parse a fetched ToleranceConclusion body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export async function parseToleranceConclusionTtl(
  url: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<ToleranceConclusionData | undefined> {
  return parseToleranceConclusion(url, await parseBody(body, url, contentType));
}

// --- DietPlan -----------------------------------------------------------------

/**
 * The current working exclusion set (DESIGN §2.2 entity 9). Per the landed 1B
 * vocab, `diet:excludes` lists the excluded TriggerClasses and `diet:restsOn`
 * lists the ToleranceConclusions those exclusions rest on — both at the plan level.
 */
export interface DietPlanData {
  /** Subject IRI (`${url}#it`); informational. */
  id?: string;
  /** `diet:excludes` → the excluded TriggerClass slugs. */
  excludes: TriggerSlug[];
  /** `diet:restsOn` → the ToleranceConclusion IRIs the exclusions rest on ("…and why"). */
  restsOn?: string[];
  /** `health:patient` — the pod-owner Patient/Person WebID. */
  patient?: string;
  /** `dcterms:created`. */
  created?: Date;
}

/** The DietPlan subject IRI: `${url}#it`. */
export function dietPlanSubject(url: string): string {
  return `${url}#it`;
}

/** Typed `@rdfjs/wrapper` view of a `diet:DietPlan`. */
export class DietPlan extends TermWrapper {
  get id(): string {
    return this.value;
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  mark(): this {
    this.types.add(DIET_DIET_PLAN);
    return this;
  }
  get isDietPlan(): boolean {
    return this.types.has(DIET_DIET_PLAN);
  }

  /** `diet:excludes` → the excluded TriggerClass IRIs (live set). */
  get excludes(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      diet("excludes"),
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** `diet:restsOn` → the ToleranceConclusion IRIs (live set; ⊑ `prov:wasDerivedFrom`). */
  get restsOn(): Set<string> {
    return SetFrom.subjectPredicate(this, DIET_RESTS_ON, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** `health:patient` — the pod-owner Patient/Person WebID. */
  get patient(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HEALTH_PATIENT_PROP, NamedNodeAs.string);
  }
  set patient(value: string | undefined) {
    OptionalAs.object(this, HEALTH_PATIENT_PROP, value, NamedNodeFrom.string);
  }

  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }
}

/** Parse a DietPlan out of a dataset, or `undefined` if `${url}#it` is not one. */
export function parseDietPlan(url: string, dataset: DatasetCore): DietPlanData | undefined {
  return tryRead(() => parseDietPlanImpl(url, dataset));
}
function parseDietPlanImpl(url: string, dataset: DatasetCore): DietPlanData | undefined {
  const doc = new DietPlan(dietPlanSubject(url), dataset, DataFactory);
  if (!doc.isDietPlan) return undefined;
  // (A DietPlan has NO sh:maxCount 1 scalar fields in the vendored SHACL — patient/
  // created are unconstrained and excludes/restsOn are set-valued — so no singleton
  // guard applies.)
  const data: DietPlanData = { id: dietPlanSubject(url), excludes: [] };
  // http(s)-filtered on READ (symmetric with the writer) — never surface a
  // non-http(s) IRI from a hostile pod document.
  setIfDefined(data, "patient", httpIriOrUndefined(doc.patient));
  setIfDefined(data, "created", validDateOrUndefined(doc.created));
  // Excluded triggers, mapped IRI → slug. FAIL-CLOSED on a corrupt restriction list:
  // a DietPlan is a SAFETY document (what the user must AVOID), so silently dropping
  // an unknown/hostile `diet:excludes` IRI and returning a PLAN WITH FEWER EXCLUSIONS
  // is dangerous (under-restriction). If any excludes triple exists but does not map
  // to a known TriggerClass, reject the whole plan rather than under-apply it.
  const rawExcludes = [...doc.excludes];
  const excludes = rawExcludes
    .map((iri) => triggerSlugFromIri(iri))
    .filter((s): s is TriggerSlug => s !== undefined)
    .sort();
  if (excludes.length !== rawExcludes.length) return undefined;
  data.excludes = excludes;
  const restsOn = sortedStrings(doc.restsOn).filter(isHttpIri);
  if (restsOn.length) data.restsOn = restsOn;
  return data;
}

/** Build a fresh n3 `Store` holding one DietPlan rooted at `${url}#it`. */
export function buildDietPlan(url: string, data: DietPlanData): Store {
  // Fail-closed on the coded values: `triggerIri` does NOT validate (it just
  // concatenates), so a non-canonical excludes slug would silently emit a bogus
  // `diet:<bad-token>` that parseDietPlan then drops. Reject it up front.
  for (const slug of data.excludes) {
    if (!isTriggerSlug(slug)) {
      throw new Error(
        `buildDietPlan: every excludes entry must be a known TriggerClass — got ${JSON.stringify(
          slug,
        )}.`,
      );
    }
  }
  const store = new Store();
  const doc = new DietPlan(dietPlanSubject(url), store, DataFactory).mark();
  doc.patient = httpIriOrUndefined(data.patient);
  doc.created = data.created ?? new Date();
  for (const slug of data.excludes) doc.excludes.add(triggerIri(slug));
  for (const iri of data.restsOn ?? []) if (isHttpIri(iri)) doc.restsOn.add(iri);
  return store;
}

/** Serialise a DietPlan to Turtle (via `n3.Writer`). */
export function serializeDietPlan(url: string, data: DietPlanData): Promise<string> {
  return storeToTurtle(buildDietPlan(url, data));
}

/** Parse a fetched DietPlan body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export async function parseDietPlanTtl(
  url: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<DietPlanData | undefined> {
  return parseDietPlan(url, await parseBody(body, url, contentType));
}
