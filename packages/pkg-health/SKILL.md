---
name: pkg-health
description: Use when reading, charting or correcting health facts in the personal knowledge graph
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Use `projectHealthFacts(parsed, { owner })` for pod or local TriG nanopublications.
Parse with pkg-memory; the reader accepts `Nanopublications`, never raw RDF strings.
Apply the owner's purpose policy before handing data to a UI. The projector keeps
all belief levels and history; consumers choose filters. Current validity is required
in addition to definite belief before acting on a fact.

`observationSeries` returns `{ series, skipped }`; `healthTimeline` returns four lanes.
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
are shared. Use only fictional example.org fixtures.
