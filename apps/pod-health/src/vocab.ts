// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Vocabulary — the SINGLE home for every IRI Pod Health reads or writes.
//
// House rule: never hand-concatenate IRIs at a call site and never hand-build
// triples. Every term used by the typed accessors comes from here, so a
// namespace change (see HEALTH below) is a one-line edit, not a sweep.

/**
 * Health sector ontology namespace.
 *
 * INTERIM: the fse health sector ontology
 * (full-solid-ecosystem/federation/ontologies/sectors/health/health.ttl)
 * currently uses the PLACEHOLDER base `https://TBD.example/solid/health#`,
 * pending fse "namespace decision #2". Pod Health builds against this interim
 * IRI verbatim so a single edit here re-points the whole data layer once the
 * namespace is frozen. See README + the tracked sector-vocab ADR follow-up.
 */
export const HEALTH = "https://TBD.example/solid/health#" as const;

/** Solid Core ontology namespace (the gUFO Core the health sector re-bases onto). */
export const CORE = "https://TBD.example/solid/core#" as const;

/** RDF, RDFS. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#" as const;

/** W3C OWL-Time (effective times — instants and intervals). */
export const TIME = "http://www.w3.org/2006/time#" as const;

/** QUDT unit vocabulary (the `unit:` namespace of individual units). */
export const UNIT = "http://qudt.org/vocab/unit/" as const;

/** Solid terms (type index, storage discovery). */
export const SOLID = "http://www.w3.org/ns/solid/terms#" as const;

/** PIM space (pod storage discovery). */
export const PIM = "http://www.w3.org/ns/pim/space#" as const;

/** XSD datatypes. */
export const XSD = "http://www.w3.org/2001/XMLSchema#" as const;

/** Dublin Core terms. */
export const DCTERMS = "http://purl.org/dc/terms/" as const;

/** GeoSPARQL / WGS84 geo positioning (workout route points). */
export const GEO = "http://www.w3.org/2003/01/geo/wgs84_pos#" as const;

/** `rdf:type`. */
export const RDF_TYPE = `${RDF}type` as const;

/** Health sector classes (verbatim from health.ttl). */
export const HealthClass = {
  Patient: `${HEALTH}Patient`,
  Practitioner: `${HEALTH}Practitioner`,
  HealthcareProvider: `${HEALTH}HealthcareProvider`,
  HealthRecord: `${HEALTH}HealthRecord`,
  ClinicalEntry: `${HEALTH}ClinicalEntry`,
  Observation: `${HEALTH}Observation`,
  VitalSign: `${HEALTH}VitalSign`,
  HeartRateObservation: `${HEALTH}HeartRateObservation`,
  StepCountObservation: `${HEALTH}StepCountObservation`,
  SleepObservation: `${HEALTH}SleepObservation`,
  ObservationActivity: `${HEALTH}ObservationActivity`,
  Condition: `${HEALTH}Condition`,
  MedicationStatement: `${HEALTH}MedicationStatement`,
  Immunization: `${HEALTH}Immunization`,
  ImmunizationActivity: `${HEALTH}ImmunizationActivity`,
  MedicinalProduct: `${HEALTH}MedicinalProduct`,
  Encounter: `${HEALTH}Encounter`,
  CodeableConcept: `${HEALTH}CodeableConcept`,
} as const;

/** Health sector properties (verbatim from health.ttl). */
export const HealthProp = {
  hasCode: `${HEALTH}hasCode`,
  value: `${HEALTH}value`,
  hasUnit: `${HEALTH}hasUnit`,
  unitCode: `${HEALTH}unitCode`,
  effectiveTime: `${HEALTH}effectiveTime`,
  patient: `${HEALTH}patient`,
  medication: `${HEALTH}medication`,
  recordedBy: `${HEALTH}recordedBy`,
  careProvider: `${HEALTH}careProvider`,
  hasEntry: `${HEALTH}hasEntry`,
  resultsIn: `${HEALTH}resultsIn`,
} as const;

/** Solid Core properties used by the health data layer (verbatim from solid-core.ttl). */
export const CoreProp = {
  /** `core:subject` — the Person a HealthRecord document is about. */
  subject: `${CORE}subject`,
  /** `core:value` — the literal code value of a CodeableConcept. */
  value: `${CORE}value`,
  /** `core:inScheme` — the coding system (SNOMED / LOINC / Apple Health) of a code. */
  inScheme: `${CORE}inScheme`,
} as const;

/** W3C OWL-Time terms (the effective-time instants and intervals on observations). */
export const TimeTerm = {
  Instant: `${TIME}Instant`,
  Interval: `${TIME}Interval`,
  inXSDDateTimeStamp: `${TIME}inXSDDateTimeStamp`,
  hasBeginning: `${TIME}hasBeginning`,
  hasEnd: `${TIME}hasEnd`,
} as const;

/** Well-known QUDT unit individuals the vital-sign types bind. */
export const Unit = {
  /** Heart rate — beats per minute (UCUM '/min'). */
  beatPerMin: `${UNIT}BEAT-PER-MIN`,
  /** Sleep duration / generic time — seconds (UCUM 's'). */
  second: `${UNIT}SEC`,
  /** Distance — metre (UCUM 'm'). */
  metre: `${UNIT}M`,
} as const;

/**
 * Pod Health application-local terms — a thin app namespace for the GPX workout
 * model the health sector ontology does not (yet) carry as first-class
 * predicates: a recorded workout with a route of geo-located track points.
 *
 * These are deliberately app-local (not asserted against the sector ontology)
 * so they never collide with sector terms. Once the health sector adds a
 * canonical activity/route model, migrate the accessors here. The route point
 * latitude / longitude / elevation reuse the standard W3C WGS84 geo vocabulary
 * rather than minting app-local geometry predicates.
 */
export const PH = "https://w3id.org/jeswr/pod-health#" as const;

export const PhClass = {
  /** A recorded physical-activity workout (a run, a ride, a walk) with a GPX route. */
  Workout: `${PH}Workout`,
  /** A single time-stamped point on a workout route (a GPX `<trkpt>`). */
  RoutePoint: `${PH}RoutePoint`,
} as const;

export const PhProp = {
  /** Workout → the patient (a core:Person) whose workout this is. */
  patient: `${PH}patient`,
  /** Workout → the kind of activity ("Run" | "Ride" | "Walk" | "Hike" | "Other"). */
  activityType: `${PH}activityType`,
  /** Workout → its start instant. */
  startTime: `${PH}startTime`,
  /** Workout → its end instant. */
  endTime: `${PH}endTime`,
  /** Workout → total distance in metres. */
  distance: `${PH}distance`,
  /** Workout → an ordered route point (one statement per point; ordered by `sequence`). */
  hasPoint: `${PH}hasPoint`,
  /** RoutePoint → its 0-based position within the route (preserves GPX track order). */
  sequence: `${PH}sequence`,
  /** RoutePoint → its instant. */
  time: `${PH}time`,
} as const;

/** WGS84 geo terms for route points (reused, not minted). */
export const GeoProp = {
  lat: `${GEO}lat`,
  long: `${GEO}long`,
  alt: `${GEO}alt`,
} as const;

/** Solid type-index terms. */
export const SolidTerm = {
  publicTypeIndex: `${SOLID}publicTypeIndex`,
  privateTypeIndex: `${SOLID}privateTypeIndex`,
  TypeIndex: `${SOLID}TypeIndex`,
  ListedDocument: `${SOLID}ListedDocument`,
  UnlistedDocument: `${SOLID}UnlistedDocument`,
  TypeRegistration: `${SOLID}TypeRegistration`,
  forClass: `${SOLID}forClass`,
  instance: `${SOLID}instance`,
  instanceContainer: `${SOLID}instanceContainer`,
} as const;
