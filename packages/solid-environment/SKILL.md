---
name: solid-environment
description: Use when reading or writing indoor environment observations, air quality monitor metadata, numeric purifier state, sensor day documents, or changing the generated SOSA/QUDT model in @jeswr/solid-environment.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Indoor environment model

Read [README.md](README.md) for the public API, property/unit inventory and document
bounds. The sector is in [environment.ttl](../solid-federation-vocab/sectors/environment/environment.ttl)
and [environment.shacl.ttl](../solid-federation-vocab/sectors/environment/environment.shacl.ttl).
`envr:` properties are provisional pending maintainer review; keep the closed list.
No device API integration belongs in this package.

Generate every RDF accessor using `@jeswr/federation-codegen`; never edit
`src/generated/`. The package profile preserves all five sector shapes intact.
Read [the generator skill](../federation-codegen/SKILL.md) before changing inputs;
run the codegen script with `--update-lock` after reviewing the input change.
The drift test must compare all regenerated artifacts byte-for-byte.

Use `buildObservation(subjectIri, input)` for a single root or
`buildObservationDay(documentUrl, sensorIri, date, entries)` for a sensor's UTC day.
The latter uses stable slug ids and many independent roots in one document, through
generated per-node wrappers. No ObservationLog vocabulary is needed. Keep one typed
quantity per observation. Sensor metadata and room builders also take exact subject
IRIs. Rooms are SOSA FeaturesOfInterest, distinct from sensor hosting Platforms.
Numeric fan/filter observations concern the purifier; text-valued modes are omitted.

Use `PROPERTY`, `UNITS`, and `PROPERTY_UNITS`; never invent device-specific vocabulary
or infer equivalent AQI/VOC scales. The facade checks finite values, property/unit
compatibility and timezone-qualified valid ISO times. Generated accessors enforce RDF
term kinds, datatypes, enums and singleton cardinalities. Follow actual quantity links
and require their types and all MUST fields. Keep schema.org manufacturer/model literal.

Read with `parseObservations` or `parseObservationsTurtle`; malformed records are skipped,
budget violations throw. Defaults: 2000 typed roots, 50000 total quads, 8 MiB UTF-8
Turtle. Count malformed/off-document roots too, snapshot a bounded dataset once, and
use indexed lookups. Do not add unbounded traversals or per-reading pod documents.
Use `observationDocPath` / `sensorDocPath` for safe relative paths and UTC partitioning.
Hosts own fetch, conditional writes, container creation and Type Index registration.

Run lint, dependency-first build, typecheck and tests for this package and
`@jeswr/solid-federation-vocab`, then `pnpm run lint:root`. Round-trip tests must also
validate generated data against the sector shape. Preserve coverage for unit mismatches,
malformed RDF, many roots, UTC boundaries, parse budgets and generated-file drift.
