---
name: pkg-health
description: Use when reading, charting or correcting health facts in the personal knowledge graph
---
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Use `projectHealthFacts(parsed, { owner })` for pod or local TriG nanopublications.
Use `importHealthExport(text, { owner })` for tolerant local exports, or parse with
pkg-memory atomically. The projector accepts `Nanopublications`, never raw strings.
Tolerant imports skip complete envelopes for term/literal validation failures and
return aggregate error-class counts; malformed RDF/metadata still fails. The existing
pkg-memory parity boundary still rejects double/dateTimeStamp during import.
Import uses `parseNanopublicationsTolerant`; keep `value.affected` when projecting or
filtering. These retained nanopub IDs are targets of IRI revision/contradiction links
in skipped metadata, including retractions. Past facts never change; affected
`definitely` facts become `might`; every non-past affected fact has
`affectedBySkipped: true` (timeline tone never `active`, series points marked): show “a later update to this could not be read”. This
context is not stored in RDF and is lost by serializing only the retained graphs.
Correspondence-batch graphs are validated/retained; envelopes sharing a skipped
head are also skipped transitively (`SharedGraphWithSkipped`).
Apply the owner's purpose policy before handing data to a UI. The projector keeps
all belief levels and history; consumers choose filters. Current validity is required
in addition to definite belief before acting on a fact.

`observationSeries` returns `{ series, skipped }`; qualitative strings stay in the
observation view with optional display-only interpretation.
Interpretation matches whole trimmed, lower-cased phrases only: high/elevated/raised,
low/decreased/reduced, abnormal/positive, normal/negative/unremarkable/within normal
limits. Borderline and compound/negated/parenthetical text have no interpretation.
Numeric strings become numbers only when faithfully representable. Labels prefer
name, rdfs label, code value/preferred label/rdfs label, then humanised kind. Sector observation subtypes
are recognised. `healthTimeline` returns five lanes, including dated `documents`.
Notes use propertyID labels and require owner additionalProperty links plus health
categories; documents require owner about/subjectOf links and a health category or
no categories at all. Exclude documents categorized only as non-health. Expose
dateCreated only for typed values passing `temporalTime`. Refuse foreign/mixed links
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

Use `importAssistantTurtle(text, { owner, assistant: { iri, label }, batchId, generatedAt })`
for non-nanopub assistant exports. It accepts both schema.org schemes and pkg namespaces,
validates each fact/source/product before building, and skips invalid facts with fixed
aggregate reasons. Scalar aliases must agree, except NFC-normalized case-only name
variants; keep the original literal of the first variant in Unicode code-point order.
Repeated source titles keep the first non-empty title in code-point order (or an explicit
empty title when all are empty). Source dates compare by calendar day, dropping date
zones without changing the day; a dateTime wins over a date on the same UTC day, and
dateTimes then compare by instant. Source dates stay dates; sub-millisecond source times
truncate. Refuse zone-less dateTimes and UTC years outside 0001–9999 on facts and sources.
Over-long quotes are dropped, never cut; a fact needs one usable quote. Every subject
alias must name the owner: canonical/legacy health patient, FHIR subject and both schema.org
schemes' subject/patient (`SUBJECT_LINK_PREDICATES`, shared with the projector), plus
schema:about on facts only; `about` on sources and in the projector names a topic. Products
naming another person refuse their statement. Fact candidates have a recognised fact type or
a patient/subject link. Foreign/mixed-subject CreativeWorks are invalid sources (referencing
facts skip InvalidSource); the assistant-export IRI is reserved; year 0000 dates are refused.
Emit only sources referenced by accepted claims; unreferenced sources and sources used only
by skipped facts must not reach the RDF. With one derived source, pair each usable quote
with it. With multiple sources, emit quote-free evidence for each, and attach quotes only
to a stable assistant-export batch document (`pkgId("assistant-export", batchId)`, id/url;
title `${assistant.label} export`, created `generatedAt`, model assistant label). Emit that
export source only if an accepted claim uses it; preserve quotes in projected provenance.
The assistant is the worker and attributed agent.
Generated local import facets preserve qualitative observations, date/dateTime precision,
statement schedules, source creation/model metadata and note labels. See the README's
import gaps before extending admission. Keep independent exports in separate batches with
the same owner; merge their TriG using the nanopub parser and preserve `affected` context.
The local CLI prints counts only; `--generated-at` fixes the clock. Never put real health
exports in fixtures or logs.
