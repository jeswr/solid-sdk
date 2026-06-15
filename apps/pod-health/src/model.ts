// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Typed RDF model — TermWrapper / DatasetWrapper accessors over the fse health
// sector ontology (FHIR-aligned Mode A + QUDT units) + the thin Pod Health app
// namespace for GPX workouts.
//
// House rule (never hand-build triples): every read/write goes through the
// @rdfjs/wrapper mapping helpers. No `dataset.add(factory.quad(...))` and no
// string-concatenated Turtle anywhere in this file.

import {
  DatasetWrapper,
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import {
  CoreProp,
  GeoProp,
  HealthClass,
  HealthProp,
  PhClass,
  PhProp,
  RDF_TYPE,
  TimeTerm,
} from "./vocab.js";

/**
 * The concrete vital-sign / observation subtypes Pod Health models, as a closed
 * string union over the health sector's Apple-Health observation subkinds. A
 * bare `health:Observation` (no subtype) reads back as `"Observation"`.
 */
export type ObservationKind = "Observation" | "HeartRate" | "StepCount" | "Sleep";

const OBS_CLASS: Record<Exclude<ObservationKind, "Observation">, string> = {
  HeartRate: HealthClass.HeartRateObservation,
  StepCount: HealthClass.StepCountObservation,
  Sleep: HealthClass.SleepObservation,
};

/**
 * `health:CodeableConcept` — a coded clinical concept (SNOMED CT / LOINC / an
 * Apple-Health type). A `core:Identifier` carrying the code value + its scheme.
 */
export class CodeableConcept extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The code value (`core:value`), e.g. "8867-4" (LOINC) or "38341003" (SNOMED). */
  get code(): string | undefined {
    return OptionalFrom.subjectPredicate(this, CoreProp.value, LiteralAs.string);
  }
  set code(value: string | undefined) {
    OptionalAs.object(this, CoreProp.value, value, LiteralFrom.string);
  }

  /** The coding-system scheme IRI (`core:inScheme`), e.g. the LOINC/SNOMED scheme. */
  get scheme(): string | undefined {
    return OptionalFrom.subjectPredicate(this, CoreProp.inScheme, NamedNodeAs.string);
  }
  set scheme(value: string | undefined) {
    OptionalAs.object(this, CoreProp.inScheme, value, NamedNodeFrom.string);
  }

  /** Stamp this node as a `health:CodeableConcept` (call once when minting). */
  markCodeableConcept(): void {
    this.types.add(HealthClass.CodeableConcept);
  }
}

/**
 * `health:Observation` (and the HeartRate / StepCount / Sleep Apple-Health
 * subtypes). A measurement RECORD: a clinical code (what), a value, an optional
 * QUDT unit + UCUM unit code, an effective time, and the patient it is about.
 *
 * The effective time is modelled as a separate `time:Instant` subject linked by
 * `health:effectiveTime`; the convenience `effectiveInstant` getter/setter reads
 * and writes the instant's `time:inXSDDateTimeStamp` for the common spot-reading
 * case. Interval effective times (sleep, daily step totals) keep the link and
 * are read via the raw `effectiveTime` IRI.
 */
export class Observation extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /**
   * The concrete observation subtype, derived from rdf:type (most specific
   * subtype wins). A bare `health:Observation` reads as `"Observation"`;
   * `undefined` only when the node carries no observation type at all.
   */
  get kind(): ObservationKind | undefined {
    const t = this.types;
    if (t.has(HealthClass.HeartRateObservation)) return "HeartRate";
    if (t.has(HealthClass.StepCountObservation)) return "StepCount";
    if (t.has(HealthClass.SleepObservation)) return "Sleep";
    if (t.has(HealthClass.Observation)) return "Observation";
    return undefined;
  }
  set kind(value: ObservationKind) {
    for (const c of Object.values(OBS_CLASS)) this.types.delete(c);
    this.types.add(HealthClass.Observation);
    if (value !== "Observation") this.types.add(OBS_CLASS[value]);
  }

  /** The clinical code IRI stating WHAT was measured (`health:hasCode`). */
  get code(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.hasCode, NamedNodeAs.string);
  }
  set code(value: string | undefined) {
    OptionalAs.object(this, HealthProp.hasCode, value, NamedNodeFrom.string);
  }

  /** The patient (a core:Person) this observation is about (`health:patient`). */
  get patient(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.patient, NamedNodeAs.string);
  }
  set patient(value: string | undefined) {
    OptionalAs.object(this, HealthProp.patient, value, NamedNodeFrom.string);
  }

  /**
   * The measured numeric value (`health:value`).
   *
   * Named `measuredValue` (not `value`) because `TermWrapper` already exposes a
   * `value: string` getter for the wrapped term's IRI — shadowing it would break
   * the RDF/JS Term contract this class relies on.
   */
  get measuredValue(): number | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.value, LiteralAs.number);
  }
  set measuredValue(v: number | undefined) {
    OptionalAs.object(this, HealthProp.value, v, LiteralFrom.double);
  }

  /** The QUDT unit IRI of the value (`health:hasUnit`), e.g. unit:BEAT-PER-MIN. */
  get unit(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.hasUnit, NamedNodeAs.string);
  }
  set unit(value: string | undefined) {
    OptionalAs.object(this, HealthProp.hasUnit, value, NamedNodeFrom.string);
  }

  /** The UCUM unit-code string of the value (`health:unitCode`), e.g. "/min". */
  get unitCode(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.unitCode, LiteralAs.string);
  }
  set unitCode(value: string | undefined) {
    OptionalAs.object(this, HealthProp.unitCode, value, LiteralFrom.string);
  }

  /** The effective-time IRI (`health:effectiveTime` → a time:Instant or time:Interval). */
  get effectiveTime(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.effectiveTime, NamedNodeAs.string);
  }
  set effectiveTime(value: string | undefined) {
    OptionalAs.object(this, HealthProp.effectiveTime, value, NamedNodeFrom.string);
  }

  /** Stamp this node as a `health:Observation` (call once when minting). */
  markObservation(): void {
    this.types.add(HealthClass.Observation);
  }
}

/**
 * A `time:Instant` — a point in time carrying an `xsd:dateTime` stamp. Used as
 * the effective time of a spot observation and the start/end of a workout.
 */
export class Instant extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The instant's timestamp (`time:inXSDDateTimeStamp`). */
  get dateTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, TimeTerm.inXSDDateTimeStamp, LiteralAs.date);
  }
  set dateTime(value: Date | undefined) {
    OptionalAs.object(this, TimeTerm.inXSDDateTimeStamp, value, LiteralFrom.dateTime);
  }

  /** Stamp this node as a `time:Instant` (call once when minting). */
  markInstant(): void {
    this.types.add(TimeTerm.Instant);
  }
}

/**
 * `health:Condition` — a coded clinical problem / diagnosis recorded for a
 * patient. A record `health:patient`-about a core:Person carrying `health:hasCode`.
 */
export class Condition extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The patient (a core:Person) this condition is about (`health:patient`). */
  get patient(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.patient, NamedNodeAs.string);
  }
  set patient(value: string | undefined) {
    OptionalAs.object(this, HealthProp.patient, value, NamedNodeFrom.string);
  }

  /** The diagnosis code IRI (`health:hasCode`). */
  get code(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.hasCode, NamedNodeAs.string);
  }
  set code(value: string | undefined) {
    OptionalAs.object(this, HealthProp.hasCode, value, NamedNodeFrom.string);
  }

  /** Stamp this node as a `health:Condition` (call once when minting). */
  markCondition(): void {
    this.types.add(HealthClass.Condition);
  }
}

/**
 * `health:MedicinalProduct` — an identifiable drug or vaccine (a core:Asset).
 */
export class MedicinalProduct extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp this node as a `health:MedicinalProduct` (call once when minting). */
  markMedicinalProduct(): void {
    this.types.add(HealthClass.MedicinalProduct);
  }
}

/**
 * `health:MedicationStatement` — a record that a patient is / was taking a
 * medicinal product. References the product via `health:medication`.
 */
export class MedicationStatement extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The patient (a core:Person) (`health:patient`). */
  get patient(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.patient, NamedNodeAs.string);
  }
  set patient(value: string | undefined) {
    OptionalAs.object(this, HealthProp.patient, value, NamedNodeFrom.string);
  }

  /** The medicinal product IRI (`health:medication`). */
  get medication(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.medication, NamedNodeAs.string);
  }
  set medication(value: string | undefined) {
    OptionalAs.object(this, HealthProp.medication, value, NamedNodeFrom.string);
  }

  /** Stamp this node as a `health:MedicationStatement` (call once when minting). */
  markMedicationStatement(): void {
    this.types.add(HealthClass.MedicationStatement);
  }
}

/**
 * `health:Immunization` — a record that a vaccine was administered to a patient.
 * References the vaccine via `health:medication`.
 */
export class Immunization extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The patient (a core:Person) (`health:patient`). */
  get patient(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.patient, NamedNodeAs.string);
  }
  set patient(value: string | undefined) {
    OptionalAs.object(this, HealthProp.patient, value, NamedNodeFrom.string);
  }

  /** The administered vaccine IRI (`health:medication`). */
  get vaccine(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.medication, NamedNodeAs.string);
  }
  set vaccine(value: string | undefined) {
    OptionalAs.object(this, HealthProp.medication, value, NamedNodeFrom.string);
  }

  /** Stamp this node as a `health:Immunization` (call once when minting). */
  markImmunization(): void {
    this.types.add(HealthClass.Immunization);
  }
}

/**
 * `health:HealthRecord` — the record document: a core:Record whose `core:subject`
 * is the patient (a core:Person). Aggregates clinical entries via `health:hasEntry`.
 * The load-bearing record-vs-subject split (the record is NOT the patient).
 */
export class HealthRecord extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /**
   * The patient (a core:Person) this record document is about (`core:subject`).
   *
   * Named `patientSubject` (not `subject`) because `TermWrapper` already exposes
   * a `subject: Term` getter (the wrapped quad's subject) — shadowing it would
   * break the RDF/JS Term contract this class relies on.
   */
  get patientSubject(): string | undefined {
    return OptionalFrom.subjectPredicate(this, CoreProp.subject, NamedNodeAs.string);
  }
  set patientSubject(value: string | undefined) {
    OptionalAs.object(this, CoreProp.subject, value, NamedNodeFrom.string);
  }

  /** The custodial care-provider organization IRI (`health:careProvider`). */
  get careProvider(): string | undefined {
    return OptionalFrom.subjectPredicate(this, HealthProp.careProvider, NamedNodeAs.string);
  }
  set careProvider(value: string | undefined) {
    OptionalAs.object(this, HealthProp.careProvider, value, NamedNodeFrom.string);
  }

  /** The live set of clinical-entry IRIs aggregated by this record (`health:hasEntry`). */
  get entries(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      HealthProp.hasEntry,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** Stamp this node as a `health:HealthRecord` (call once when minting). */
  markHealthRecord(): void {
    this.types.add(HealthClass.HealthRecord);
  }
}

/** A GPX workout activity kind, as a closed string union. */
export type ActivityType = "Run" | "Ride" | "Walk" | "Hike" | "Other";

/**
 * `ph:RoutePoint` — a single time-stamped, geo-located point on a workout route
 * (a GPX `<trkpt>`). Latitude / longitude / elevation reuse the W3C WGS84 geo
 * vocabulary; `ph:sequence` preserves the GPX track order.
 */
export class RoutePoint extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** 0-based position within the route (`ph:sequence`) — preserves GPX order. */
  get sequence(): number | undefined {
    return OptionalFrom.subjectPredicate(this, PhProp.sequence, LiteralAs.number);
  }
  set sequence(value: number | undefined) {
    OptionalAs.object(this, PhProp.sequence, value, LiteralFrom.integer);
  }

  /** Latitude in decimal degrees (`geo:lat`). */
  get lat(): number | undefined {
    return OptionalFrom.subjectPredicate(this, GeoProp.lat, LiteralAs.number);
  }
  set lat(value: number | undefined) {
    OptionalAs.object(this, GeoProp.lat, value, LiteralFrom.double);
  }

  /** Longitude in decimal degrees (`geo:long`). */
  get long(): number | undefined {
    return OptionalFrom.subjectPredicate(this, GeoProp.long, LiteralAs.number);
  }
  set long(value: number | undefined) {
    OptionalAs.object(this, GeoProp.long, value, LiteralFrom.double);
  }

  /** Elevation in metres above sea level (`geo:alt`), if the GPX point carried it. */
  get elevation(): number | undefined {
    return OptionalFrom.subjectPredicate(this, GeoProp.alt, LiteralAs.number);
  }
  set elevation(value: number | undefined) {
    OptionalAs.object(this, GeoProp.alt, value, LiteralFrom.double);
  }

  /** The point's timestamp (`ph:time`). */
  get time(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, PhProp.time, LiteralAs.date);
  }
  set time(value: Date | undefined) {
    OptionalAs.object(this, PhProp.time, value, LiteralFrom.dateTime);
  }

  /** Stamp this node as a `ph:RoutePoint` (call once when minting). */
  markRoutePoint(): void {
    this.types.add(PhClass.RoutePoint);
  }
}

/**
 * `ph:Workout` — a recorded physical-activity session (a run, ride, walk) with a
 * route of `ph:RoutePoint`s parsed from a GPX track. An app-local concept (the
 * health sector ontology has no activity/route model yet — see the tracked
 * sector-vocab ADR follow-up to migrate this upstream).
 */
export class Workout extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The patient (a core:Person) whose workout this is (`ph:patient`). */
  get patient(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PhProp.patient, NamedNodeAs.string);
  }
  set patient(value: string | undefined) {
    OptionalAs.object(this, PhProp.patient, value, NamedNodeFrom.string);
  }

  /** The activity kind (`ph:activityType`). */
  get activityType(): ActivityType | undefined {
    return OptionalFrom.subjectPredicate(this, PhProp.activityType, LiteralAs.string) as
      | ActivityType
      | undefined;
  }
  set activityType(value: ActivityType | undefined) {
    OptionalAs.object(this, PhProp.activityType, value, LiteralFrom.string);
  }

  /** The workout's start instant (`ph:startTime`). */
  get startTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, PhProp.startTime, LiteralAs.date);
  }
  set startTime(value: Date | undefined) {
    OptionalAs.object(this, PhProp.startTime, value, LiteralFrom.dateTime);
  }

  /** The workout's end instant (`ph:endTime`). */
  get endTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, PhProp.endTime, LiteralAs.date);
  }
  set endTime(value: Date | undefined) {
    OptionalAs.object(this, PhProp.endTime, value, LiteralFrom.dateTime);
  }

  /** Total distance in metres (`ph:distance`). */
  get distance(): number | undefined {
    return OptionalFrom.subjectPredicate(this, PhProp.distance, LiteralAs.number);
  }
  set distance(value: number | undefined) {
    OptionalAs.object(this, PhProp.distance, value, LiteralFrom.double);
  }

  /** The live set of route-point IRIs (`ph:hasPoint`). Order via RoutePoint.sequence. */
  get points(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      PhProp.hasPoint,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** Stamp this node as a `ph:Workout` (call once when minting). */
  markWorkout(): void {
    this.types.add(PhClass.Workout);
  }
}

/**
 * A whole resource document, wrapped so sibling subjects (multiple records /
 * observations / etc. in one container resource) can be listed and minted.
 * Registrations and health entities are *sibling subjects* in a document, so
 * this must be a DatasetWrapper (not reachable from one root term).
 */
export class HealthDocument extends DatasetWrapper {
  /** Every `health:HealthRecord` subject in the document. */
  get records(): Iterable<HealthRecord> {
    return this.instancesOf(HealthClass.HealthRecord, HealthRecord);
  }

  /** Every `health:Observation` subject in the document (includes all subtypes). */
  get observations(): Iterable<Observation> {
    return this.instancesOf(HealthClass.Observation, Observation);
  }

  /** Every `health:Condition` subject in the document. */
  get conditions(): Iterable<Condition> {
    return this.instancesOf(HealthClass.Condition, Condition);
  }

  /** Every `health:MedicationStatement` subject in the document. */
  get medicationStatements(): Iterable<MedicationStatement> {
    return this.instancesOf(HealthClass.MedicationStatement, MedicationStatement);
  }

  /** Every `health:Immunization` subject in the document. */
  get immunizations(): Iterable<Immunization> {
    return this.instancesOf(HealthClass.Immunization, Immunization);
  }

  /** Every `health:MedicinalProduct` subject in the document. */
  get medicinalProducts(): Iterable<MedicinalProduct> {
    return this.instancesOf(HealthClass.MedicinalProduct, MedicinalProduct);
  }

  /** Every `health:CodeableConcept` subject in the document. */
  get codeableConcepts(): Iterable<CodeableConcept> {
    return this.instancesOf(HealthClass.CodeableConcept, CodeableConcept);
  }

  /** Every `ph:Workout` subject in the document. */
  get workouts(): Iterable<Workout> {
    return this.instancesOf(PhClass.Workout, Workout);
  }

  /** Every `ph:RoutePoint` subject in the document. */
  get routePoints(): Iterable<RoutePoint> {
    return this.instancesOf(PhClass.RoutePoint, RoutePoint);
  }

  // --- resolution helpers --------------------------------------------------

  /** Wrap an existing observation subject IRI (read or continue editing it). */
  observation(iri: string): Observation {
    return new Observation(iri, this, this.factory);
  }

  /** Wrap an existing codeable-concept subject IRI. */
  codeableConcept(iri: string): CodeableConcept {
    return new CodeableConcept(iri, this, this.factory);
  }

  /** Wrap an existing instant subject IRI. */
  instant(iri: string): Instant {
    return new Instant(iri, this, this.factory);
  }

  /** Wrap an existing route-point subject IRI. */
  routePoint(iri: string): RoutePoint {
    return new RoutePoint(iri, this, this.factory);
  }

  /**
   * The route points of a workout, ordered by `ph:sequence` (ascending). Points
   * with no sequence sort last (treated as +Infinity) and in IRI order amongst
   * themselves, so a route always reads back deterministically.
   */
  orderedPoints(workout: Workout): RoutePoint[] {
    const pts = [...workout.points].map((iri) => this.routePoint(iri));
    return pts.sort((a, b) => {
      const sa = a.sequence ?? Number.POSITIVE_INFINITY;
      const sb = b.sequence ?? Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;
      // `points` is a Set of IRIs, so the two values are always distinct — a
      // strict less-than fully orders the tie-break with no equal case.
      return a.value < b.value ? -1 : 1;
    });
  }

  // --- minting helpers (write into the same underlying dataset) ------------

  /** Mint a new health-record document subject. */
  mintHealthRecord(iri: string): HealthRecord {
    const r = new HealthRecord(iri, this, this.factory);
    r.markHealthRecord();
    return r;
  }

  /** Mint a new observation subject (optionally a specific subtype via `kind`). */
  mintObservation(iri: string, kind: ObservationKind = "Observation"): Observation {
    const o = new Observation(iri, this, this.factory);
    o.kind = kind;
    return o;
  }

  /** Mint a new codeable-concept subject. */
  mintCodeableConcept(iri: string): CodeableConcept {
    const c = new CodeableConcept(iri, this, this.factory);
    c.markCodeableConcept();
    return c;
  }

  /** Mint a new time:Instant subject. */
  mintInstant(iri: string): Instant {
    const i = new Instant(iri, this, this.factory);
    i.markInstant();
    return i;
  }

  /** Mint a new condition subject. */
  mintCondition(iri: string): Condition {
    const c = new Condition(iri, this, this.factory);
    c.markCondition();
    return c;
  }

  /** Mint a new medication-statement subject. */
  mintMedicationStatement(iri: string): MedicationStatement {
    const m = new MedicationStatement(iri, this, this.factory);
    m.markMedicationStatement();
    return m;
  }

  /** Mint a new immunization subject. */
  mintImmunization(iri: string): Immunization {
    const i = new Immunization(iri, this, this.factory);
    i.markImmunization();
    return i;
  }

  /** Mint a new medicinal-product subject. */
  mintMedicinalProduct(iri: string): MedicinalProduct {
    const m = new MedicinalProduct(iri, this, this.factory);
    m.markMedicinalProduct();
    return m;
  }

  /** Mint a new workout subject. */
  mintWorkout(iri: string): Workout {
    const w = new Workout(iri, this, this.factory);
    w.markWorkout();
    return w;
  }

  /** Mint a new route-point subject. */
  mintRoutePoint(iri: string): RoutePoint {
    const p = new RoutePoint(iri, this, this.factory);
    p.markRoutePoint();
    return p;
  }
}
