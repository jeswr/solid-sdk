---
name: solid-health
description: Use when writing or reading imported health-sector observations, selecting clinical codes and QUDT or UCUM units, choosing metric/month document paths, or regenerating the health measurement model.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Health observations

Read README.md and codegen/health.shapes.ttl before changing the write profile. The
sector source of truth is ../solid-federation-vocab/sectors/health/health.shacl.ttl.
Use buildObservation and parseObservations; never handwrite domain accessor classes
or model manifests. HealthObservation, HealthCode and HealthInstant are generated
constructor aliases. Keep the facade's patient locality, unit policy and explicit
lexical timezone check. Do not widen the profile or rewrite the ontology's timestamp
range to conceal a generator gap.

Use code for source field codes and loincCode only for real LOINC codes. Schemes are
coding systems, never source field identifiers. Preserve document-local patients;
account exports do not identify the pod owner. Generic HRV/VO2max use Observation
and UCUM strings; do not invent sector classes or unverified QUDT IRIs.

Keep monthlyDocumentPath compatible with health/observations/<metric>/<YYYY-MM>.ttl.
parseObservations throws on document/candidate budget exhaustion and returns only
valid generated projections. The focus adapter must return original raw quads;
never reconstruct sanitized field values before validation.

Changes to inputs require pnpm run codegen and the byte-for-byte drift test. Never
edit src/generated. Read ../federation-codegen/SKILL.md before changing the profile
or config. Run lint, build, typecheck and test, then lint:root. Keep Garmin's fixture
expectations unchanged except for explicitly documented, tested behavior changes.
