<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/solid-environment

Generated SOSA/QUDT RDF models for indoor air monitors and numeric purifier state.
Experimental; the environment sector's `envr:` observable properties are provisional
pending maintainer review. This package performs no network requests or device discovery.

```ts
import {
  buildObservationDay, buildRoom, buildSensor, observationDocPath,
  parseObservationsTurtle, PROPERTY, sensorDocPath, storeToTurtle, UNITS,
} from "@jeswr/solid-environment";

const pod = "https://pod.example/";
const sensor = `${pod}${sensorDocPath("office-monitor")}#sensor`;
const room = `${pod}rooms.ttl#office`;
const documentUrl = `${pod}${observationDocPath("office-monitor", "2026-11-11")}`;
const sensorData = buildSensor(sensor, {
  label: "Office monitor", manufacturer: "IKEA", model: "ALPSTUGA",
});
const roomData = buildRoom(room, { label: "Office" });
const day = buildObservationDay(documentUrl, sensor, "2026-11-11", [{
  id: "co2-120000", property: PROPERTY.CO2Concentration, value: 650,
  unit: UNITS.PPM, featureOfInterest: room, resultTime: "2026-11-11T12:00:00Z",
}]);
const turtle = await storeToTurtle(day);
const readings = await parseObservationsTurtle(documentUrl, turtle);
```

`buildObservation(subjectIri, input)` returns an N3 Store for one observation and
one linked, explicitly typed `qudt:QuantityValue`. The subject IRI is exact, including
its fragment. `buildSensor(subjectIri, input)` and `buildRoom(subjectIri, { label })`
also take exact subject IRIs. `parseSensor(subjectIri, dataset)` returns metadata or
`undefined`. An optional `isHostedBy` refers to a SOSA Platform; `buildSensor` includes
its type locally. Rooms are SOSA FeaturesOfInterest because observations describe the
air in a room. The hosting platform is a separate physical support for a sensor.

`parseObservations(documentUrl, dataset, options?)` returns records with `iri`,
`sensor`, `property`, `featureOfInterest`, `resultTime` (UTC ISO string), `value` and
`unit`. It selects explicitly typed SOSA Observation roots at the document IRI or inside its
fragment namespace. Unrelated roots are omitted. Malformed observations are skipped;
a cap violation throws and never returns a partial result. Foreign sensor and feature
links need not have their descriptions in the observation document.

All public builders reject invalid required fields. Numbers must be finite; units
must match properties. Timestamps require an explicit timezone and valid XSD calendar
values; timezone-less RDF is skipped on read. Subject and reference IRIs must be
canonical absolute HTTP(S) IRIs without credentials, preserving their exact identity.
Invalid optional sensor values follow the runtime's drop-on-read policy.

| Property | Unit constant | Generic QUDT quantity kind |
| --- | --- | --- |
| `CO2Concentration` | `PPM` | `DimensionlessRatio` |
| `PM2_5MassConcentration`, `PM10MassConcentration` | `MICROGM_PER_M3` | `MassConcentration` |
| `VOCIndex`, `AirQualityIndex`, `FanSpeedLevel` | `UNITLESS` | `Dimensionless` |
| `AirTemperature` | `DEG_C` | `Temperature` |
| `RelativeHumidity` | `PERCENT` | `RelativeHumidity` |
| `FilterLifeRemaining` | `PERCENT` | `DimensionlessRatio` |

`PROPERTY` and `UNITS` contain full IRIs; `PROPERTY_UNITS` is the frozen compatibility
map. QUDT's microgram unit is `http://qudt.org/vocab/unit/MicroGM-PER-M3`. CO2 uses the
explicitly authorized `DimensionlessRatio` fallback because this offline workspace
has no pinned gas-concentration quantity-kind inventory. The property individuals
have no external equivalence mappings. AQI/VOC and fan-level scales are device-specific;
do not compare devices' values without knowing their algorithms. Fan/filter state
fits a numeric observation whose feature of interest is the purifier. Text-valued
purifier modes are omitted.

One sensor's observations for one UTC day share **one document**:
`environment/<sensor>/<yyyy>/<mm>/<dd>.ttl`. Sensor metadata lives at
`environment/<sensor>/sensor.ttl`. Both path helpers return relative paths; slugs are
1–128 lowercase ASCII letters/digits with single internal hyphens. Dates may be UTC
date strings, timezone-qualified ISO timestamps or valid Dates. Date partitioning
uses UTC even when input timestamps have offsets. Hosts create intermediate containers
and register `sosa:Observation` / `sosa:Sensor` in the Type Index as appropriate.

The runtime's generated per-node wrappers accept arbitrary subject IRIs and datasets,
so the document contains many observation roots and quantities without inventing an
ObservationLog class. The composite convenience `build` fixes its root fragment;
this facade uses its generated node wrappers for independent root identities. It
checks the presence of all MUST fields through guarded getters and follows exactly
one typed quantity. RDF accessors, datatype/cardinality/enum guards and writes remain
generated. The facade adds property/unit and ISO-time policy.

`buildObservationDay(documentUrl, sensorIri, date, readings, options?)` validates every
entry against that sensor and UTC day, rejects duplicate ids, and returns one Store.
Ids follow the slug rules and become `#observation-<id>`; quantities get `--result`
appended to their observation IRI. Stable ids should include the source timestamp and
property; connectors own deduplication and conditional whole-document writes. Do not
call `buildObservation` with a day URL alone when merging readings; supply distinct
fragment IRIs or use the day helper.

Bounds apply before per-record parsing: `maxObservations` defaults to **2000** and counts
all explicitly typed roots, including malformed/off-document ones; `maxQuads` defaults
to **50000** across the entire dataset. The Turtle entry point also caps UTF-8 input at
**8 MiB** with `maxBytes`. Every limit must be a positive integer at most 10000000.
The RDF parser enforces byte and constructed-quad caps while parsing (duplicates count);
the observation cap applies before per-record validation. The dataset API snapshots at most the quad cap, then uses indexed N3
lookups. Named graphs are rejected. The day builder also applies observation/quad caps.

The complete sector SHACL is in
[`environment.shacl.ttl`](../solid-federation-vocab/sectors/environment/environment.shacl.ttl).
`codegen/environment.shapes.ttl` preserves all its constraints without omissions or
narrowing. Config adds HTTP(S) policy. Property/unit pairing, explicit timezones and
resource budgets are facade policy, not extra SHACL constructs.

```sh
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-environment run codegen
pnpm --filter @jeswr/solid-environment run lint
pnpm --filter @jeswr/solid-environment run build
pnpm --filter @jeswr/solid-environment run typecheck
pnpm --filter @jeswr/solid-environment run test
```

Never edit `src/generated/`. After reviewing changed generation inputs, regenerate
with `pnpm --filter @jeswr/solid-environment run codegen --update-lock`. The drift test
compares every artifact byte-for-byte, including the lockfile. Tests use synthetic data
and validate against the sector's SHACL with the workspace's existing validator.
