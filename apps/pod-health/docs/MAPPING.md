# Pod Health — data model mapping

How the Pod Health typed accessors (`src/model.ts`) map onto the fse health sector ontology
(FHIR-aligned Mode A + QUDT) and the app-local `ph:` workout terms. This is the reference for what
each accessor reads/writes; the ontology itself lives in
[`full-solid-ecosystem`](https://github.com/jeswr/full-solid-ecosystem) under
`federation/ontologies/sectors/health/`.

> Namespaces: `health:` = `https://TBD.example/solid/health#` (fse placeholder, pending namespace
> decision #2), `core:` = `https://TBD.example/solid/core#`, `time:` =
> `http://www.w3.org/2006/time#`, `unit:` = `http://qudt.org/vocab/unit/`, `geo:` =
> `http://www.w3.org/2003/01/geo/wgs84_pos#`, `ph:` = `https://w3id.org/jeswr/pod-health#`,
> `solid:` = `http://www.w3.org/ns/solid/terms#`.

## Classes

| Accessor class | RDF class | gUFO meta-type / role |
|---|---|---|
| `HealthRecord` | `health:HealthRecord` | SubKind of `core:Record` (the record document; `core:subject` is the patient) |
| `Observation` | `health:Observation` (+ `health:VitalSign`, `health:HeartRateObservation`, `health:StepCountObservation`, `health:SleepObservation`) | SubKind of `core:Record` ∩ `core:Quantity` (a measurement record) |
| `Condition` | `health:Condition` | SubKind of `core:Record` (a coded clinical finding about the patient) |
| `MedicationStatement` | `health:MedicationStatement` | SubKind of `core:Record` |
| `Immunization` | `health:Immunization` | SubKind of `core:Record` |
| `MedicinalProduct` | `health:MedicinalProduct` | Kind under `core:Asset` |
| `CodeableConcept` | `health:CodeableConcept` | SubKind of `core:Identifier` (SNOMED/LOINC/Apple code) |
| `Instant` | `time:Instant` | W3C OWL-Time (the effective time of a spot observation) |
| `Workout` | `ph:Workout` | app-local (no sector activity model yet) |
| `RoutePoint` | `ph:RoutePoint` | app-local (a GPX `<trkpt>`; geo via WGS84) |

## Properties

| Accessor | Predicate | Range | FHIR alignment (Mode A) |
|---|---|---|---|
| `HealthRecord.patientSubject` | `core:subject` | `core:Person` | Composition.subject (renamed from `subject` to avoid the inherited `TermWrapper.subject`) |
| `HealthRecord.careProvider` | `health:careProvider` | `core:Organization` | Composition.custodian |
| `HealthRecord.entries` | `health:hasEntry` | `health:ClinicalEntry` | document/composition section |
| `Observation.code` / `Condition.code` | `health:hasCode` | `health:CodeableConcept` | Observation.code / Condition.code |
| `Observation.patient` etc. | `health:patient` | `core:Person` | *.subject |
| `Observation.measuredValue` | `health:value` | xsd literal | Observation.value[x] (renamed to avoid `TermWrapper.value`) |
| `Observation.unit` | `health:hasUnit` | `qudt:Unit` | Quantity.system+code |
| `Observation.unitCode` | `health:unitCode` | xsd:string (UCUM) | Quantity.code |
| `Observation.effectiveTime` | `health:effectiveTime` | `time:TemporalEntity` | Observation.effective[x] |
| `CodeableConcept.code` | `core:value` | literal | Coding.code |
| `CodeableConcept.scheme` | `core:inScheme` | scheme IRI | Coding.system |
| `MedicationStatement.medication` / `Immunization.vaccine` | `health:medication` | `health:MedicinalProduct` | MedicationStatement.medication / Immunization.vaccineCode |
| `Instant.dateTime` | `time:inXSDDateTimeStamp` | xsd:dateTime | — |
| `Workout.patient` | `ph:patient` | `core:Person` | — (app-local) |
| `Workout.activityType` | `ph:activityType` | string union | — |
| `Workout.startTime` / `.endTime` | `ph:startTime` / `ph:endTime` | xsd:dateTime | — |
| `Workout.distance` | `ph:distance` | xsd:double (metres) | — |
| `Workout.points` | `ph:hasPoint` | `ph:RoutePoint` | — |
| `RoutePoint.sequence` | `ph:sequence` | xsd:integer | preserves GPX order |
| `RoutePoint.lat` / `.long` / `.elevation` | `geo:lat` / `geo:long` / `geo:alt` | xsd:double | WGS84 (reused, not minted) |
| `RoutePoint.time` | `ph:time` | xsd:dateTime | GPX `<time>` |

## Vital-sign units (QUDT / UCUM)

| Observation kind | QUDT unit | UCUM code |
|---|---|---|
| HeartRate | `unit:BEAT-PER-MIN` | `/min` |
| Sleep (duration) | `unit:SEC` | `s` |
| StepCount | dimensionless | `{steps}` |

## Two TermWrapper name collisions (load-bearing)

`@rdfjs/wrapper`'s `TermWrapper` base class already exposes RDF/JS Term members `value: string`
(the wrapped term's IRI) and `subject: Term` (the quad subject). Two health-sector predicates
would otherwise shadow them, breaking the Term contract the accessors rely on, so they are renamed:

- `health:value` → `Observation.measuredValue` (not `.value`).
- `core:subject` → `HealthRecord.patientSubject` (not `.subject`).

## GPX parsing

GPX is XML, not RDF, so `src/gpx.ts` extracts the narrow `<trk>/<trkseg>/<trkpt>` structure with a
small self-contained scanner — deliberately **not** a general XML library (the published
`fast-xml-parser` 5.x tree carries several low-reputation transitive deps). The extracted points
are then mapped onto the typed `Workout` / `RoutePoint` accessors, so the "never a bespoke RDF
parser" house rule holds: the scanner touches only the XML envelope; all RDF flows through
`@rdfjs/wrapper`.
