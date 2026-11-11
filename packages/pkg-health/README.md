<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pkg-health

Experimental, private, security-critical workspace package. A UI-free reader for
“what my assistant knows about my health”. Accepts parsed PKG nanopublications from
`NanopubStore.list()` or `parseNanopublications(trig)`. No fetching, logging, analytics,
clinical advice or dependency on a UI framework. Requires Node 24.

```ts
import {
  projectHealthFacts, observationSeries, healthTimeline, classifyBodySystem,
  forgetHealthFact, correctHealthFact, importHealthExport,
} from "@jeswr/pkg-health";

const view = projectHealthFacts(await store.list(), { owner: ownerWebId });
const { series, skipped } = observationSeries(view, { beliefs: ["definitely"] });
const lanes = healthTimeline(view);
const system = view.facts[0] && classifyBodySystem(view.facts[0]);
await forgetHealthFact(store, nanopubId, { clientId, batchId });
await correctHealthFact(store, nanopubId, correctedFact, { clientId, batchId });
```

`projectHealthFacts(value, { owner, now? })` returns `facts`, `byKind`, `unrecognised`,
`sources` and `excludedOtherSubjects`. Kinds are condition, allergy, medication,
observation, immunization, encounter, note and document. Each fact carries its nanopub ID, assertion
ID, typed subject IRI, label, code, lexical period and parsed epoch milliseconds,
belief/validity/epistemic metadata, hedge, categories, replacement IDs, corroboration
and provenance. Conditions expose onset/abatement; medication exposes product and dose;
observations expose number-or-string value, unit and effective time; immunizations
and encounters expose a date, and encounters retain the recorder IRI. Decimal doses
retain their lexical string (including scale). Plain decimal numeric strings become
numbers when faithfully representable. Notes expose `property` (the propertyID),
humanised label and string `value`; documents expose `name` and optional `dateCreated`.

A nanopub can project multiple typed records; its `id` stays the nanopub IRI. Use
`(id, subject, kind)` when a UI needs a distinct key for each record. `byKind` contains
the same fact objects as `facts`. `unrecognised` uses `kind: "unrecognised"` and keeps
available labels and metadata, including a typed observation with no usable value.
Linked products and codes are supporting records rather than independent fact kinds.
A category-only product/code remains in `unrecognised`.

A recognised record qualifies if it has a health category or an explicit owner link
through canonical/legacy `health:patient`, `fhir:subject` or `schema:subject`.
Notes require a health category and an owner `schema:additionalProperty` link to a
`schema:PropertyValue`. Documents require `schema:about` owner or owner
`schema:subjectOf` document. Foreign or malformed links in either direction refuse
these records, including mixed owner/foreign links; unlinked records never qualify
through the category fallback. Named and blank note/document subjects are supported.
Any foreign or malformed subject link on a record excludes it, even beside an
owner link or a health category. Missing subject links are accepted only with a
health category. The owner identity is explicit and compared exactly; attribution
identifies the reporter, so it is never substituted for the patient. The exclusion
count is once per nanopub containing excluded records. Mixed assertions retain the
owner's records. Category fallback also checks foreign subject links. Unrelated
assertion/source/entity graphs do not supply labels or values.

`HEALTH_CATEGORIES` is an explicit subset of pkg-memory's `isSpecialCategory` list:
MedicalHealth, BloodType, Disability, DNACode, DrugTestResult, Health, PhysicalHealth,
HealthHistory, FamilyHealthHistory, IndividualHealthHistory, HealthRecord,
Prescription, Genetic and MentalHealth, all under `https://w3id.org/dpv/pd#`.
Other special categories (including biometrics, politics and religion) do not
implicitly qualify. No DPV fetching or subclass inference occurs.

Beliefs come directly from `classifyNanopublications`: `definitely`, `might`,
`mentioned`, `past`. Every level and historical revision remains visible. Contradicted
facts are retained. Revisions and withdrawals preserve `replacedBy` links. Consumers
choose their filters; actions on beliefs must additionally require Current validity.
`now` is an optional clock seam reserved for consumers; projection does not infer
clinical activity, expire a period or change a stored validity based on wall time.

Temporal bounds retain the XSD lexical value **as present in the parsed input**;
the builder may already have applied its documented RDFlib normalization. `date`,
`gYearMonth`, `gYear` and `dateTime` have calendar-checked `startTime`/`endTime` in ms.
Partial dates use the first instant of their stated calendar period, and zone-less
values use UTC. Invalid/unrepresentable dates stay lexical without a parsed time.
Fractional precision beyond milliseconds stays in the lexical value. Effective time
supports a direct literal or an OWL-Time instant/interval beginning, including
`time:inXSDDate`, `time:inXSDDateTime` and `time:inXSDDateTimeStamp`, with a bounded read.
`xsd:dateTimeStamp` requires a timezone. The four locally declared sector subtypes
VitalSign, HeartRateObservation, StepCountObservation and SleepObservation (including
legacy w3id aliases) project as observations, once even when base types are also present.
This is a fixed sector inventory, not reasoning over untrusted ontology statements.

`observationSeries(view, { beliefs? })` returns `{ series, skipped }`. Each series is
`{ id, label, unit?, points: [{ x: ISO, y: number, factId }] }`. Numeric observations
group by code IRI (otherwise system/value), or normalized label, plus exact unit.
Code IRI namespaces identify SNOMED, LOINC, ICD-10, ATC and dm+d; unknowns remain
`other`. Values that cannot be represented faithfully as a JS number remain strings.
Time comes from effective time, otherwise the period start. Missing/invalid times and
nonnumeric values increment `skipped` after belief filtering. Points sort by time;
series sort by ID. No unit conversion or aggregation occurs.

`healthTimeline(view, { beliefs? })` returns condition, medication, immunization,
encounter and documents arrays of `{ id, start?, end?, label, tone }`. An end or past belief gives
`past`; otherwise Current gives `active`; remaining facts are `neutral`. Dates remain
lexical; the original four lanes retain undated items. The documents lane includes
only documents with `dateCreated`, using that date. Notes never enter a timeline.
These are display tones, not clinical conclusions.

Labels and qualitative results

Label order is `schema:name`, `rdfs:label`, linked `health:hasCode` concept
`core:value` (canonical then legacy), `skos:prefLabel`, `rdfs:label`, then the
humanised kind (for example “Observation”). Notes use their humanised propertyID.
Medication product names remain a fallback for statements without their own label.
Series grouping prefers code IRI, then code system/value, then normalised label.

Observations retain qualitative string results. `interpretation` is optional and
uses this ordered, case-insensitive whole-word display table. Parenthetical text is
ignored, so “normal (numeric value not transcribed)” displays as normal. Outside
parentheses, not/no/possibly/possible/uncertain/unknown suppress interpretation.

| Interpretation | Keywords |
| --- | --- |
| high | high, elevated, raised |
| low | low, decreased, reduced |
| abnormal | abnormal, positive |
| normal | normal, negative, unremarkable |

This table does not interpret clinical meaning, ranges, or units. Unmatched text
stays a string with no interpretation. Numeric decimal/integer/double literals are
read by datatype; non-finite or inexact numbers remain lexical strings. Decimal
numeric strings such as “4.2” become numbers; qualitative results never enter series.

Tolerant local import

```ts
const { value, skipped } = await importHealthExport(trig, { owner: ownerWebId });
const view = projectHealthFacts(value, { owner: ownerWebId });
// skipped: { count, reasons: { UnsupportedLiteralCharacterError: 2 } }
```

The importer delegates to additive pkg-memory `parseNanopublications(text,
{ invalid: "skip", baseIRI? })`, whose result also has `skipped: [{ id, errorClass }]`.
Existing parser calls stay atomic, including the string baseIRI overload. Tolerance
covers literal/term validation only; invalid TriG or malformed nanopub metadata still
fails, exposed here as a fixed `HealthGraphError`. Each head/assertion/provenance/pubinfo
envelope is kept or dropped together. A bad shared assertion drops every referencing
nanopub; a bad batch source/entity graph drops its batch users. Batch graphs survive
only with a kept user. Unrelated/orphan graphs are omitted. Nothing rewrites hashes,
terms or literal values. No values or diagnostics enter skip reasons.

The owner must be an explicit safe HTTP(S) IRI. Import retains all valid nanopubs,
including non-health and foreign claims; apply purpose policy and owner-scoped
projection before display. pkg-memory's existing RDFlib parity policy still excludes
`xsd:double` and `xsd:dateTimeStamp`: tolerant import counts/skips these as unsupported
datatypes, while the projector can read them in an existing `Nanopublications` value.

Fictional demo

```ts
import { exampleHealthKnowledge } from "@jeswr/pkg-health/testing";
const demo = await exampleHealthKnowledge({ now: "2026-11-01T12:00:00Z" });
const view = projectHealthFacts(demo, { owner: "https://example.org/people/avery#me" });
```

Returns `Promise<Nanopublications>` built exclusively through the public batch/fact
builders and generated build APIs. The default now is the fixed timestamp above.
For fixed now, nanopub IDs, values, dates, provenance and projected output are stable;
RDF blank-node labels allocated by pkg-memory may differ between invocations.
All identities and resource IRIs are fictional example.org values (plus standard
vocabulary and builder-generated UUID URNs). The 77 facts span about 18 months:
eight condition claims (current, historical, hedged, mentioned, contradicted pair,
superseded/revised pair), three medicines (one stopped, one with a schedule), two
allergies, one immunization, three encounters, four six-point laboratory series,
26 weekly resting heart rates, eight notes and two documents. Five sources have
titles, fictional models and created dates (four Codex threads and one Claude
session); every claim has a fictional evidence quote. Qualitative demo results are
omitted for the generator union gap below; numeric rises are a fictional story,
not treatment guidance.

`forgetHealthFact` delegates to `store.retract`, appending a Retracted revision. It
never deletes. `correctHealthFact` accepts only the condition, allergy and medication
`Fact` templates. It reads the original, verifies its single patient is the store's
explicit `ownerWebId`, builds a SelfReportedExplicit revision with owner-correction
evidence, then puts it. The builder's batch-local `supersedes` reference uses an
unpublished anchor for the original; the typed wrapper preserves its exact assertion
IRI if hashing a previously skolemized graph gives a different ID. Only the revision
and its required batch graphs are put. The original bytes remain unchanged. Unsupported
corrections throw `HealthGraphError` with `code: "unsupported-correction"`. All errors
use fixed messages without fact values or backend diagnostics. Failed writes propagate
as `write-failed`; use a fresh batch ID when intentionally making another correction.

Provenance model

`FactProvenance` and `SourceInfo` are shared read-only types exported by pkg-memory.
`readNanopubProvenance` reads each nanopub's own evidence and its batch sources graph;
it never re-derives these graph names in this package. Publication generation time,
agent IRI/label, batch and attribution stay separate from evidence timestamps/speakers.
Source metadata includes kind, title, thread ID, model and creation date. Document and
email URLs are their source IRIs; provider-specific thread URLs are not invented.
Message evidence retains the message IRI as `source`, and resolves its containing
conversation for source metadata. Direct document evidence retains quote/locator.
Only referenced sources are returned, deduplicated by IRI; unused batch sources are
excluded. Evidence order follows parsed annotations and is not chronological.

The builder only persists each evidence's timestamp/speaker on a message record when
`message_id` is supplied. For direct document/thread evidence, these per-evidence fields
cannot be recovered; the reader leaves them absent. It does not mislabel the assertion's
earliest aggregate provenance time as each quote's timestamp. Missing source metadata
stays optional. Ambiguous or wrongly typed source scalar fields fail closed. The projector uses a per-call provenance reader that copies each batch source graph
once, and an assertion graph cache. There is no global cache: later projections read
fresh data. All whole-dataset graph lookups use indexed `match` operations. Regression
tests count these operations over 4,500 records, without a timing threshold.

Body-system heuristic (display only)

`classifyBodySystem` uses the first matching explicit code rule below, then lower-cased
whole-word label keywords, then `general`. This is a small local display table, never
clinical inference, SNOMED ancestry reasoning, diagnosis or treatment guidance. Codes
are only used when their declared system matches; arbitrary numeric strings are not
assumed to be SNOMED codes. Drug buckets do not identify an owner's diagnosis.

| Bucket | Explicit SNOMED identifiers | ICD-10 chapter/range | ATC first letter | Label keywords |
| --- | --- | --- | --- | --- |
| cardiovascular | 49601007, 38341003, 53741008 | I | B, C | heart, cardiac, hypertension, blood pressure, cholesterol |
| respiratory | 50043002, 195967001, 13645005 | J | R | asthma, lung, respiratory, copd, breathing |
| digestive | 53619000, 235719002, 235595009 | K00–K93 | A | coeliac, celiac, bowel, stomach, digestive, reflux, crohn |
| endocrine and metabolic | 362969004, 73211009, 44054006 | E00–E90 | H | diabetes, thyroid, endocrine, metabolic, glucose |
| musculoskeletal | 928000, 69896004 | M | M | arthritis, joint, muscle, bone, back pain |
| nervous system | 118940003, 37796009 | G except G47 | N | migraine, epilepsy, neurological, nerve, seizure |
| mental health | 74732009, 35489007 | F | — | anxiety, depression, mental, bipolar, adhd, ptsd |
| skin | 95320005, 24079001 | L | D | skin, eczema, psoriasis, rash, dermatitis |
| immune and allergy | 414285001, 419199007 | A, B, D50–D89 | J, L, P | allergy, allergic, allergies, anaphylaxis, immune, immunization, vaccine |
| eyes and ears | 371405004, 232347008 | H00–H95 | S | eye, eyes, ear, ears, vision, hearing, glaucoma, tinnitus |
| kidney and urinary | 90708001, 709044004 | N00–N39 | — | kidney, renal, urinary, bladder |
| reproductive and sexual health | 289903006 | N40–N99, O | G | reproductive, sexual, pregnancy, menstrual, prostate |
| sleep | 39898005 | G47 | — | sleep, insomnia, apnoea, apnea |
| general | everything else | unlisted chapters | V / unlisted | no match |

Keyword priority is sleep, immune/allergy, mental health, cardiovascular, respiratory,
digestive, endocrine/metabolic, musculoskeletal, nervous system, skin, eyes/ears,
kidney/urinary, reproductive/sexual. This prioritization only stabilizes display groups.

Generator gaps

The generated core has fifteen assertion/supporting-record shapes, including all four
sector observation subtypes, OWL-Time Instant, PropertyValue and DigitalDocument.
Canonical and legacy aliases, schema:MedicalCondition/Drug and FHIR/schema Observation
remain supported. `codegen/pkg-health.shapes.ttl` documents the read/build narrowings:
numeric builds use xsd:decimal; Instant and document creation builds use xsd:dateTime;
effective-time builds use named Instant links. Mixed imported values remain readable.
This reader profile accepts incomplete historical records; it is not the sector's
normative clinical validator.

1. Shared aliases: admission rejects aliased predicates shared by multiple entity
   owners. patient, hasCode, medication, unitCode and hasUnit therefore use canonical generated fields
   plus a minimal canonical-first typed compatibility view for legacy reads. Owner
   filtering examines all subject predicates and refuses conflicting identities.
2. BlankNodeOrIRI records: schema:doseSchedule and schema:code can be blank nodes or
   their PKG skolem IRIs. Typed wrapper views read decimal doseValue/doseUnit/frequency
   and MedicalCode codeValue/codingSystem. No handwritten domain model or quad builder.
3. Mixed datatypes: SHACL's heterogeneous date/dateTime/gYearMonth/gYear bounds and
   numeric-or-string observation values have no admitted single-field union. Typed
   literal views preserve raw lexical forms and datatype-aware numeric reads.
4. Effective time: the sector's TemporalEntity link and pilot literal dates are not
   one admitted field type. The read view handles literal values and one OWL-Time
   interval-beginning/instant traversal. It does not interpret other interval relations.

5. Qualitative demo builds: a second shape for the same Observation class with a
   string value is rejected (multiple NodeShapes per canonical targetClass); the
   generator admits no heterogeneous numeric/string field union. The demo therefore
   omits qualitative results. Imported qualitative observations remain supported and
   exhaustively tested. No new generator/runtime behaviour is introduced.
6. Blank subjects: generated entity wrappers require NamedNodes. Imported blank
   PropertyValue and DigitalDocument records use bounded read-only typed views;
   demo notes use the existing preference template, which skolemizes the blank node.

The original gaps remain documented for maintainer follow-up (HKG-A1/A2); the
qualitative demo limitation is the same mixed-value union gap, not a new model workaround. The
codegen/runtime packages and generated files are never hand-edited. Regenerate with
`pnpm --filter @jeswr/pkg-health codegen`; the drift test compares every artifact byte
for byte. Build copies generated JS/declarations into dist. Biome excludes generated
output; no dist artifacts are committed.

Privacy

Never log, transmit or put fact values, quotes, source titles or identifiers into error
messages, telemetry or analytics. The projector itself performs no I/O. Callers must
apply the owner's purpose policy before supplying data to a UI or tool, and perform
any required special-category audit in the application. This reader does not confer
access rights. Mutations use NanopubStore's existing owner-only protection. Tests use
fictional example.org identities and the in-memory PodPort; no real person's data.

<!-- AUTHORED-BY Codex GPT-6 -->
For a local import benchmark, build the packages and run
`node --expose-gc packages/pkg-health/scripts/bench-import.mjs <file>` from the workspace
root. Set `PKG_BENCH_OWNER` to the export owner's WebID; the default is the fictional
`https://example.org/people/avery#me`. Output contains counts, operation time and sampled
peak `heapUsed` after explicit GC, without fact
values or parser diagnostics. Timing uses an uninstrumented pass, including automatic
GC, with no forced GC between import and projection. A separate pass samples
`heapUsed` after forced GC during store insertion, graph reads and at operation
boundaries; profiling time is excluded. The peak is sampled, rather than continuous.

Generate a reproducible fictional input with
`node packages/pkg-health/test/support/synthetic-export.ts /tmp/fictional-health.trig`.
It builds 4,500 nanopubs across 40 batches using public batch/fact builders and the
pkg-memory serializer. An optional final argument changes the nanopub count. The CI
regression uses 600 nanopubs and counts store insertions instead of timing assertions.
