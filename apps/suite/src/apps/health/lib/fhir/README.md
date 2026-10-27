<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Health FHIR R4 export (HLT-L6)

Pure TypeScript; no I/O, React, RDF, conversions or dependencies. Import from
`index.ts`. `buildFhirBundle(records, options)` returns fresh JSON-compatible
data; `serialiseFhirBundle(records, options)` returns compact JSON with stable
key order. Required arrays: `observations`, `medications`, `conditions` (empty
arrays are valid). Options require `clock: () => Date`, `uuid: () => string` and
optionally `patientReference` (an absolute HTTP(S) REST Patient URL).
An empty Bundle omits `entry`, following R4's rule to omit empty arrays in
[FHIR JSON](https://hl7.org/fhir/R4/json.html).

Observations have `{id, metric, value, unit, effective, source}`. Only these exact
metric/unit combinations are accepted:

| Metric | LOINC | UCUM | Category |
| --- | --- | --- | --- |
| weight | 29463-7 | kg | vital-signs |
| height | 8302-2 | cm | vital-signs |
| heartRate | 8867-4 | /min | vital-signs |
| steps | 55423-8 | {steps} | activity |
| bodyTemperature | 8310-5 | Cel | vital-signs |
| oxygenSaturation | 59408-5 | % | vital-signs |
| bloodPressure | 85354-9 | mm[Hg] | vital-signs |

Blood-pressure `value` is `{systolic, diastolic}`; one Observation contains
components 8480-6 then 8462-4, with no panel-level value. Other values are finite
numbers within JavaScript's safe magnitude. Values are never clinically
interpreted, rounded, converted, or paired across records. Status is `final`.
Source is preserved in `note: [{text: "Source: <source>"}]`, without inventing a
device or clinical actor.

Medications have `{id, name, dosageText, start, end?}`; names map to
`medicationCodeableConcept.text`, dosage to `dosage[0].text`, dates to
`effectivePeriod`. Status is `unknown` because dates do not establish clinical
status. Conditions have `{id, name, onset}` and emit `code.text` and
`onsetDateTime`; no diagnosis codes or clinical status are inferred.

An explicit `patientReference`, e.g. `https://example.org/fhir/Patient/person-1`,
is preserved as `subject.reference` on every resource. It must be a canonical
HTTP(S) URL ending in `/Patient/<FHIR logical ID>`, without credentials, query
or fragment. This replaces the former `patientId` option: bare IDs and relative
references cannot resolve against UUID entry URLs under
[R4's bundle reference rules](https://hl7.org/fhir/R4/bundle.html#references)
and are rejected. Without a reference, Observation omits subject; MedicationStatement and
Condition retain their required subject using the display-only Reference
`{display: "Patient not supplied"}`. No Patient resource is generated.

IDs use FHIR's 1–64 ASCII letter/digit/hyphen/dot syntax and must be unique
within a resource kind; the same ID across kinds is valid. Full URLs use unique
UUIDs from the injected generator (hex case canonicalized to lowercase).
Resources sort by lexical FHIR kind (Condition, MedicationStatement,
Observation), chronological onset/start/effective instant, then code-unit ID.
Callbacks run only after all input records validate, and UUID assignment follows
sorted order. Deterministic callbacks therefore give identical JSON for any
input permutation. Clock runs once, even for an empty bundle.

Dates use strict Gregorian years 0001–9999. Observation effective time requires
`YYYY-MM-DDTHH:mm:ss[.SSS]Z` or an explicit offset up to ±14:00. Medication and
condition dates also accept `YYYY-MM-DD`, sorted at midnight UTC. Original date
strings are preserved. Invalid dates, unzoned times, rollover dates, excess
precision and reversed medication periods fail. A period's endpoints may match.
Period comparisons use calendar days when either endpoint is date-only; an end
includes every matching time at its supplied day, second or fractional-second
precision, following [R4 Period.end](https://hl7.org/fhir/R4/datatypes-definitions.html#Period.end).

`MAX_FHIR_RECORDS` (100,000) applies to the combined arrays, checked before
element inspection, copying, sorting or callbacks. Unknown fields, non-data
objects, sparse/custom arrays, malformed values and duplicate IDs fail closed.
`MAX_FHIR_STRING_LENGTH` (1,048,576 Unicode characters) bounds text and markdown
primitives in both input validation and the self-check, including the generated
`Source: ` prefix and Patient reference strings. Oversized text is rejected,
never truncated, under [R4's string limit](https://hl7.org/fhir/R4/datatypes.html#string).
`FhirExportError.code` is one of `UNSUPPORTED_METRIC`, `UNIT_MISMATCH`,
`TOO_MANY_RECORDS`, `INVALID_INPUT`, `INVALID_OPTIONS`, `INVALID_BUNDLE`.
Messages never include input or callback exception details.

`assertFhirBundle(unknown)` throws `INVALID_BUNDLE` for malformed output, or
`TOO_MANY_RECORDS` for an oversized entry array. It checks this exporter's
structural subset: envelope, IDs/UUID uniqueness, subjects, status, coding,
categories, quantities, blood-pressure components, dosage, text and dates.
It is not a full FHIR schema/profile or clinical validator. R4 resource definitions:
[Observation](https://hl7.org/fhir/R4/observation.html),
[MedicationStatement](https://hl7.org/fhir/R4/medicationstatement.html),
[Condition](https://hl7.org/fhir/R4/condition.html).
