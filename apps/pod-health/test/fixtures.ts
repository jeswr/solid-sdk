// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Test fixtures — sample RDF + GPX inputs shared across the data-layer suite.

/**
 * A conformant health record document in Turtle, mirroring the fse health sector
 * conformant test instance (a patient, a provider, a record with a heart-rate
 * vital and a condition).
 */
export const CONFORMANT_HEALTH_TTL = `
@prefix health: <https://TBD.example/solid/health#> .
@prefix core:   <https://TBD.example/solid/core#> .
@prefix unit:   <http://qudt.org/vocab/unit/> .
@prefix time:   <http://www.w3.org/2006/time#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .
@prefix ex:     <https://carol.example/health/> .

ex:Carol a core:Person, health:Patient .
ex:Clinic a core:Organization, health:HealthcareProvider .

ex:Record a health:HealthRecord ;
    core:subject ex:Carol ;
    health:careProvider ex:Clinic ;
    health:hasEntry ex:HR1 , ex:Cond1 .

ex:HR1 a health:Observation, health:VitalSign, health:HeartRateObservation ;
    health:patient ex:Carol ;
    health:hasCode ex:LoincHeartRate ;
    health:value "72"^^xsd:decimal ;
    health:hasUnit unit:BEAT-PER-MIN ;
    health:unitCode "/min" ;
    health:effectiveTime ex:T1 .

ex:LoincHeartRate a health:CodeableConcept ;
    core:value "8867-4" .

ex:T1 a time:Instant ;
    time:inXSDDateTimeStamp "2026-06-13T08:00:00Z"^^xsd:dateTime .

ex:Cond1 a health:Condition ;
    health:patient ex:Carol ;
    health:hasCode ex:SctHypertension .

ex:SctHypertension a health:CodeableConcept ;
    core:value "38341003" .
`;

/** A type-index document already carrying a HealthRecord registration. */
export const TYPE_INDEX_TTL = `
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix health: <https://TBD.example/solid/health#> .

<https://carol.example/settings/publicTypeIndex.ttl>
    a solid:TypeIndex, solid:ListedDocument .

<https://carol.example/settings/publicTypeIndex.ttl#registration-pod-health-records>
    a solid:TypeRegistration ;
    solid:forClass health:HealthRecord ;
    solid:instanceContainer <https://carol.example/health/> .
`;

/** A small GPX 1.1 track: three timed, elevated points forming a short route. */
export const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="pod-health-test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Morning Run</name>
    <trkseg>
      <trkpt lat="51.5007" lon="-0.1246">
        <ele>12.0</ele>
        <time>2026-06-13T07:00:00Z</time>
      </trkpt>
      <trkpt lat="51.5010" lon="-0.1250">
        <ele>13.5</ele>
        <time>2026-06-13T07:00:30Z</time>
      </trkpt>
      <trkpt lat="51.5014" lon="-0.1255">
        <ele>14.0</ele>
        <time>2026-06-13T07:01:00Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

/** A GPX track with a self-closing trkpt, no elevation, and no time. */
export const SPARSE_GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="40.0" lon="-70.0"/>
  </trkseg></trk>
</gpx>`;

/** A GPX document with a malformed trkpt (missing lon) amongst good ones. */
export const PARTIAL_GPX = `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="1.0" lon="2.0"><time>2026-06-13T07:00:00Z</time></trkpt>
    <trkpt lat="3.0"><time>2026-06-13T07:01:00Z</time></trkpt>
    <trkpt lat="4.0" lon="5.0"></trkpt>
  </trkseg></trk>
</gpx>`;

/** Not a GPX document at all. */
export const NOT_GPX = `<?xml version="1.0"?><kml><Placemark/></kml>`;
