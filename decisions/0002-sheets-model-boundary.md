<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Sheets model boundary (SHT-00)

Status: Implements the model-first amendment; engine work remains in SHT-01.

The source of record is `specs/apps/07-parity-backlog.md`, Sheets, amended by
`specs/apps/08-model-first.md` in solid-suite-planning. SHT-00 supplies pure models
under `apps/suite/src/apps/sheets/lib/model/`, with injected fetch for resource I/O.

A workbook container has `index.ttl#it` typed as both
`schema:SpreadsheetDigitalDocument` and `schema:Dataset`. It records `dct:title`,
`dct:created`, `dct:modified`, `dct:creator`, and `schema:hasPart` downloads. Each
`sheets/<n>.csv` is a `schema:DataDownload` with `text/csv` encoding, a name,
position, content URL and `schema:subjectOf` descriptor. Each `sheets/<n>.jsonld`
is a dataset with a distribution pointing to the CSV and ordered
`schema:variableMeasured` columns. `schema:encoding` links the workbook snapshot.
These use the existing HTTPS schema.org and standard DCT/XSD/Solid namespaces.

RDF writes use typed `@rdfjs/wrapper` accessors. Turtle uses the suite's
`@jeswr/rdf-serialize` (n3 Writer); expanded JSON-LD uses
`jsonld-streaming-serializer` over the same wrapper-authored dataset. Reads use
`@jeswr/fetch-rdf` parsing. Descriptors reject contexts before parsing to avoid
remote-context requests. The model requires no React, hooks or suite SDK.

CSV is a table with a header and rectangular rows. Numbers and ISO dates are
inferred across each non-blank column. Ambiguous/mixed columns stay text; leading
zero IDs and unsafe integer lexemes stay text. A supplied descriptor preserves
intentional numeric/date-like text. Blank fields (including empty text) read as
null. Dates export as UTC ISO date-time strings; CSV does not retain formulas or
formatting. JSON snapshots preserve those engine-specific values as opaque JSON.

Every resource save requires either `If-None-Match: *` or a strong `If-Match` ETag.
Missing read ETags remain null and never become an unconditional write. HTTP
errors retain status and remote ETag; network/parse errors propagate. No retries
or multi-resource transaction guarantee are implied. The future hook schedules
saves and handles partial saves and conflicts. Container provisioning and Type
Index discovery/bootstrap belong to that integration; model registration writes
one instance to an existing index and preserves unrelated RDF.

The model reuses Pod Manager's DataCollection/TypeRegistration accessor and
read-modify-write patterns, while making fetch mandatory. Requests use the
existing guarded-fetch pod scope and redirect refusal. No new guard is invented.

The planning decision selects **Univer**, recording `@univerjs/core` as
Apache-2.0 (verified by the planner on 2026-10-25). SHT-00 installs no engine.
Engine adapter, lazy chunk, independent licence verification and measured bundle
size are **unmeasured and deferred to SHT-01**, as explicitly required by the
model-first split. SHT-01 must record gzip size against the specified 2.5 MB lazy
chunk threshold. FortuneSheet remains only the planner's documented fallback if
that measurement exceeds the threshold. This ADR does not change that decision.

The descriptor predicate and Type Index integration questions are recorded in
`QUESTIONS.md`. No UI or browser fixture is introduced in SHT-00.
