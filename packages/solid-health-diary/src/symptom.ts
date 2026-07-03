// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `diet:Symptom` (⊑ `health:Observation`) — a symptom the pod owner logged
 * (DESIGN §2.2 entity 4). One pod resource per symptom
 * (`symptoms/{yyyy}/{mm}/{ulid}.ttl`).
 *
 * `schema:startTime` is the **onset** time — the other half of every lag
 * calculation (the Meal ingestion time is the first half). The breathing /
 * anaphylaxis symptom types are specially flagged ({@link isEmergencySymptomType},
 * mirroring `diet:triggersEmergencyRail` in the vocab) so the UI shows the
 * emergency rail, never "we'll correlate it" (RESEARCH §4).
 *
 * `symptomType` is stored as a canonical `diet:` **concept IRI** (camelCase); the
 * accessor exposes the friendly kebab token via `symptomTypeCodec`.
 *
 * Typed accessors over an n3 `Store`; never hand-built triples.
 */

import type { DatasetCore } from "@rdfjs/types";
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
import { symptomTypeCodec } from "./concepts.js";
import { httpIriOrUndefined } from "./iri.js";
import { assertSubjectSingletons } from "./rdfGuards.js";
import { parseBody, storeToTurtle } from "./serialize.js";
import { setIfDefined, tryRead, validDateOrUndefined } from "./util.js";
import {
  DIET_SYMPTOM,
  dct,
  diet,
  HEALTH_OBSERVATION,
  HEALTH_PATIENT_PROP,
  rdf,
  schema,
} from "./vocab.js";

/** A known symptom-type token (the vocab's `skos:notation`; stored as `diet:{camelCase}`). */
export type SymptomType = (typeof symptomTypeCodec.tokens)[number];

/** The known symptom-type tokens (DESIGN §2.2 entity 4; extensible). */
export const SYMPTOM_TYPES: readonly SymptomType[] = symptomTypeCodec.tokens;

/**
 * Symptom types that are a medical EMERGENCY, not a data point (RESEARCH §4;
 * mirrors `diet:triggersEmergencyRail true` on these concepts in the vocab). The
 * UI must short-circuit to the emergency rail for these; never "correlated away".
 */
export const EMERGENCY_SYMPTOM_TYPES: readonly SymptomType[] = ["wheeze-breathing", "anaphylaxis"];

/** True if `slug` is a known symptom type. */
export function isSymptomType(slug: string): slug is SymptomType {
  return symptomTypeCodec.isToken(slug);
}

/** True if a symptom type triggers the hard-coded emergency rail (RESEARCH §4). */
export function isEmergencySymptomType(slug: string): boolean {
  return (EMERGENCY_SYMPTOM_TYPES as readonly string[]).includes(slug);
}

/** The `diet:{concept}` symptom-type IRI for a friendly token. */
export function symptomTypeIri(slug: SymptomType): string {
  return symptomTypeCodec.toIri(slug);
}
/** The symptom-type token for a `diet:{concept}` IRI, or `undefined`. */
export function symptomTypeFromIri(iri: string): SymptomType | undefined {
  return symptomTypeCodec.fromIri(iri);
}

/** A symptom observation (DESIGN §2.2 entity 4). */
export interface SymptomData {
  /** Subject IRI (`${url}#it`); informational. */
  id?: string;
  /** `diet:symptomType` — the SKOS-coded symptom (required). */
  symptomType: SymptomType;
  /** `schema:startTime` — ONSET time (required; the lag calculation's second half). */
  onset: Date;
  /** `diet:severity` — ordinal 0–10 (0 = none, 10 = worst). */
  severity?: number;
  /** `diet:note`. */
  note?: string;
  /** `health:patient` — the pod-owner Patient/Person WebID. */
  patient?: string;
  /** `dcterms:created`. */
  created?: Date;
}

/** Typed `@rdfjs/wrapper` view of a `diet:Symptom`. */
export class Symptom extends TermWrapper {
  get id(): string {
    return this.value;
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp as `diet:Symptom` + `health:Observation`. Idempotent; returns `this`. */
  mark(): this {
    this.types.add(DIET_SYMPTOM);
    this.types.add(HEALTH_OBSERVATION);
    return this;
  }
  get isSymptom(): boolean {
    return this.types.has(DIET_SYMPTOM);
  }

  /** `diet:symptomType` → `diet:{concept}`; read back as the friendly token. */
  get symptomType(): SymptomType | undefined {
    return symptomTypeCodec.fromIri(
      OptionalFrom.subjectPredicate(this, diet("symptomType"), NamedNodeAs.string),
    );
  }
  set symptomType(value: SymptomType | undefined) {
    OptionalAs.object(
      this,
      diet("symptomType"),
      value ? symptomTypeCodec.toIri(value) : undefined,
      NamedNodeFrom.string,
    );
  }

  /** `schema:startTime` — onset time. */
  get onset(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, schema("startTime"), LiteralAs.date);
  }
  set onset(value: Date | undefined) {
    OptionalAs.object(this, schema("startTime"), value, LiteralFrom.dateTime);
  }

  /** `diet:severity` — ordinal 0–10. */
  get severity(): number | undefined {
    return OptionalFrom.subjectPredicate(this, diet("severity"), LiteralAs.number);
  }
  set severity(value: number | undefined) {
    OptionalAs.object(this, diet("severity"), value, LiteralFrom.integer);
  }

  get note(): string | undefined {
    return OptionalFrom.subjectPredicate(this, diet("note"), LiteralAs.string);
  }
  set note(value: string | undefined) {
    OptionalAs.object(this, diet("note"), value, LiteralFrom.string);
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

/** The Symptom subject IRI: `${url}#it`. */
export function symptomSubject(url: string): string {
  return `${url}#it`;
}

/** The SHACL `sh:maxCount 1` predicates for a Symptom (only these are guarded). */
const SYMPTOM_SINGLETONS: readonly string[] = [schema("startTime"), diet("severity")];

/** Whether a parsed/loaded symptom is a medical emergency (convenience). */
export function isEmergency(symptom: Pick<SymptomData, "symptomType">): boolean {
  return isEmergencySymptomType(symptom.symptomType);
}

/**
 * `diet:severity` is an ORDINAL integer 0–10 (0 = none, 10 = worst; DESIGN §2.2 /
 * the vendored vocab `diet:severity` definition). `undefined` ⇒ valid (severity is
 * optional). Anything else — a non-integer, a NaN, or a value outside `[0, 10]` —
 * is INVALID. The vendored SHACL shape (owned upstream by `solid-federation-vocab`
 * — not forked here) does not yet express `sh:minInclusive`/`maxInclusive`, so this
 * range is enforced in CODE: {@link buildSymptom} refuses to persist an invalid
 * ordinal (fail-closed) and {@link parseSymptom} drops one read from an untrusted
 * pod document, so an out-of-range severity can never be written or surfaced.
 */
function isValidSeverity(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value >= 0 && value <= 10);
}

/** Parse a Symptom out of a dataset, or `undefined` if `${url}#it` is not a `diet:Symptom`. */
export function parseSymptom(url: string, dataset: DatasetCore): SymptomData | undefined {
  return tryRead(() => parseSymptomImpl(url, dataset));
}
function parseSymptomImpl(url: string, dataset: DatasetCore): SymptomData | undefined {
  const doc = new Symptom(symptomSubject(url), dataset, DataFactory);
  if (!doc.isSymptom) return undefined;
  assertSubjectSingletons(dataset, symptomSubject(url), SYMPTOM_SINGLETONS);
  const symptomType = doc.symptomType;
  if (!symptomType) return undefined;
  // `schema:startTime` is the ONSET — the other half of every lag calculation and
  // a SHACL MUST. A symptom without it is not a usable record; never coerce a
  // missing onset to the 1970 epoch (which would corrupt lag correlation). Reject.
  const onset = validDateOrUndefined(doc.onset);
  if (!onset) return undefined;
  const data: SymptomData = {
    id: symptomSubject(url),
    symptomType,
    onset,
  };
  // Ordinal 0–10 only — drop an out-of-range/non-integer severity from an untrusted
  // pod document rather than surface an invalid ordinal to consumers.
  const severity = doc.severity;
  setIfDefined(data, "severity", isValidSeverity(severity) ? severity : undefined);
  setIfDefined(data, "note", doc.note);
  // http(s)-filtered on READ (symmetric with the writer) — never surface a
  // non-http(s) IRI from a hostile pod document.
  setIfDefined(data, "patient", httpIriOrUndefined(doc.patient));
  setIfDefined(data, "created", validDateOrUndefined(doc.created));
  return data;
}

/** Build a fresh n3 `Store` holding one Symptom rooted at `${url}#it`. */
export function buildSymptom(url: string, data: SymptomData): Store {
  // Fail-closed on the SHACL MUSTs (symmetric with parseSymptom, which rejects a
  // record missing either). JS callers / bad casts could smuggle a missing or
  // non-canonical symptomType, or a missing/invalid onset — refuse to emit a
  // document that would fail validation and parse back as undefined.
  if (!data.symptomType || !isSymptomType(data.symptomType)) {
    throw new Error(
      `buildSymptom: symptomType is REQUIRED and must be a known symptom type — got ${JSON.stringify(
        data.symptomType,
      )}.`,
    );
  }
  if (!(data.onset instanceof Date) || Number.isNaN(data.onset.getTime())) {
    throw new Error(
      "buildSymptom: onset must be a valid Date (schema:startTime — a SHACL MUST and " +
        "the second half of every lag calculation).",
    );
  }
  // Fail-closed on the ordinal contract: refuse to persist a severity that is not
  // an integer 0–10 (an invalid ordinal would round-trip as bogus health data).
  if (!isValidSeverity(data.severity)) {
    throw new Error(
      `buildSymptom: severity must be an integer 0–10 (ordinal scale) — got ${JSON.stringify(
        data.severity,
      )}.`,
    );
  }
  const store = new Store();
  const doc = new Symptom(symptomSubject(url), store, DataFactory).mark();
  doc.symptomType = data.symptomType;
  doc.onset = data.onset;
  doc.severity = data.severity;
  doc.note = data.note;
  doc.patient = httpIriOrUndefined(data.patient);
  doc.created = data.created ?? new Date();
  return store;
}

/** Serialise a Symptom to Turtle (via `n3.Writer`). */
export function serializeSymptom(url: string, data: SymptomData): Promise<string> {
  return storeToTurtle(buildSymptom(url, data));
}

/** Parse a fetched Symptom body (Turtle / JSON-LD) via `@jeswr/fetch-rdf`. */
export async function parseSymptomTtl(
  url: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<SymptomData | undefined> {
  return parseSymptom(url, await parseBody(body, url, contentType));
}
