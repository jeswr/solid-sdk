---
name: pkg-health
description: Use when reading, charting or correcting health facts in the personal knowledge graph
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Use `projectHealthFacts(parsed, { owner })` for pod or local TriG nanopublications.
Use `importHealthExport(text, { owner })` for tolerant local exports, or parse with
pkg-memory atomically. The projector accepts `Nanopublications`, never raw strings.
Tolerant imports skip complete envelopes for term/literal validation failures and
return aggregate error-class counts; malformed RDF/metadata still fails. The existing
pkg-memory parity boundary still rejects double/dateTimeStamp during import.
Apply the owner's purpose policy before handing data to a UI. The projector keeps
all belief levels and history; consumers choose filters. Current validity is required
in addition to definite belief before acting on a fact.

`observationSeries` returns `{ series, skipped }`; qualitative strings stay in the
observation view with optional display-only interpretation. Numeric strings become
numbers only when faithfully representable. Labels prefer name, rdfs label, code
value/preferred label/rdfs label, then humanised kind. Sector observation subtypes
are recognised. `healthTimeline` returns five lanes, including dated `documents`.
Notes use propertyID labels and require owner additionalProperty links plus health
categories; documents require owner about/subjectOf links. Refuse foreign/mixed links
in either direction. Notes never appear on the timeline.
Body-system classification is a display heuristic, never clinical inference. Preserve
lexical dates and units; do not invent precision, unit conversions or source metadata.
Use `(id, subject, kind)` for UI keys when one nanopub contains multiple records.

`forgetHealthFact` appends a retraction. `correctHealthFact` supports the condition,
allergy and medication Fact templates, verifies the stored owner identity and appends
a SelfReportedExplicit revision. Keep original history. Never delete nanopubs or
expose private values in errors, logs, telemetry or network requests.

The domain core is generated from `codegen/`. Never edit `src/generated/` by hand.
Run `pnpm run codegen` and the byte drift test after input changes. Read the README's
Generator gaps before changing compatibility views. Shared predicate aliases,
blank-node dose/code records and mixed temporal/value datatypes use small read-only
wrapper views; do not add handwritten model accessors to bypass admission.

Provenance comes from pkg-memory's `readNanopubProvenance`; do not derive batch graph
names here. Message timestamps/speakers are optional and unavailable for direct
non-message evidence. Keep quotes attached to their own nanopub, even when assertions
are shared. Use only fictional example.org fixtures. `@jeswr/pkg-health/testing` exports
`exampleHealthKnowledge({ now? })`, a fixed-clock fictional Avery story built solely
with batch/fact/generated builders. Do not add hand-written quads or Turtle to it.
Its qualitative observation builds are omitted for the documented generator union
gap. Preserve per-projection assertion and provenance graph caches; do not introduce
per-fact full-dataset scans or global caches.
