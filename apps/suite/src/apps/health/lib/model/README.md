<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Health model (HLT-00)

Import from `./index.js`. This layer has no UI, session, global fetch or SDK facade dependency.
The typed entities and GPX scanner are ported from `apps/pod-health`; namespace constants and
read aliases come from `@jeswr/suite-vocab`. The original deployable is unchanged.

- `HealthDocument`, `parseHealth`, `toTurtle`: mutable typed RDF documents. Turtle writes reject
  named graphs and unsafe IRIs; unknown data, resource identities and literal contents survive.
- `addMeasurement`, `measurements`, `aggregateMetric`: canonical QUDT/UCUM values for steps,
  heart rate, sleep duration, weight and systolic/diastolic pressure. Clinical codes use
  `health:CodeableConcept`; effective dates use `time:Instant`. Observation code/time links
  retain RDF terms, including blank nodes; resolution helpers accept terms or IRI strings.
  Dates and shard keys use UTC.
  Range end is exclusive. Steps and sleep sum; other metrics average. Weeks start Monday.
- `addRecord`, `records`, `Reminder`: health records, conditions, medications and immunisations,
  with names/notes and `sched:Reminder` timestamps. Reminder delivery belongs to HLT-01.
- `gpxToWorkout`, `workouts`: ordered route points and segment-aware distance; also read
  `schema:ExerciseAction` connector documents. See root `QUESTIONS.md` for the vocabulary choice.
- `importAppleHealth(chunks, iriFor)`: an async generator over extracted XML string chunks,
  yielding canonical measurements. It normalizes Apple dates/units, skips unsupported types and
  in-bed/awake sleep summaries, and throws for malformed supported measurements/XML. It does not
  retain/upload XML or write observations. Provide streaming text decoding before this function
  for byte streams. Consumers can add samples to month documents and persist each shard. Keep
  chunk sizes bounded; backpressure occurs between chunks. A late XML error may follow yielded
  samples, so callers choose preview/staging versus partial-import reporting.
  The `iriFor(index, attributes)` callback also receives the decoded source-record attributes,
  allowing callers to derive identities independent of export filename, ordering and chunking.
  HLT-01 fingerprints sorted attributes with injected SHA-256 before persistence, so repeated or
  overlapping exports replace the same observations without saving the XML or its attributes.
- `createHealthStore(fetch, storageRoot, owner)`: pod-scoped, redirect-refusing I/O.
  Inline JSON-LD contexts are supported; external contexts/imports are rejected on resource
  and ACL reads. Use
  `initialize()` to create the fixed layout; mutations also initialize it. WAC ACL links are
  required; existing ACLs must be owner-private. A failed privacy setup blocks sensitive writes,
  including on retry. Each mutation uses `If-None-Match: *` or a strong ETag. Conflicts surface as
  `HealthIoError` with status 412; read errors retain `RdfFetchError` status. Missing list/shard
  documents are empty; other errors propagate. `write()` is the low-level conditional writer for
  existing paths and caller-batched documents; initialize containers before creating documents.
- Store operations: `addObservation(id, sample)`, `metric(kind, range)`,
  `saveRecord(id, input, precondition)`, `loadRecords(kind)`, `importGpx(id, xml)`,
  `loadWorkouts(connectorPaths?)`, `read(path)`, `write(path, document, precondition)`, `migrate(path)`.
  Workout reads merge native indexes with `health/workouts.ttl` (Apple Health) and
  `health/activities.ttl` (Garmin/Fitbit), or explicitly supplied in-scope connector paths.
  Missing connector files are empty; other read errors propagate. Results are unique by subject IRI.
  `importGpx` accepts an optional `onRouteSaved` callback after a route is saved or an identical
  existing route is verified, before writing its index. The data layer uses it to report partial
  imports; retrying with the same ID resumes that route without creating another resource.
  `migrate` rewrites vocabulary in an explicitly supplied existing resource once; repeat calls
  perform no PUT. Discovery of resources to migrate stays with the caller.

HLT-01 supplies hooks, subscriptions, Type Index discovery/registration, offline caching/outbox
and UI. This model does not assume their APIs. No new vocabulary terms or dependencies on the
old private deployable are introduced.

## Food and symptom diary

`lib/data/diary.ts` uses `@jeswr/solid-health-diary` builders, parsers and exposure derivation
for all diary entities. Health canonicalizes schema.org to HTTPS; a read-only adapter presents
HTTP schema.org predicates to the package parser. Thin typed accessors add optional
`schema:keywords` tags on meals and `schema:duration` (`PT<n>M`) on symptoms.
An omitted package severity remains “not recorded”; it is never converted to zero.

Entries occupy one resource each at `health/diary/<yyyy-mm>/<uuid>.ttl`, rooted at `#it`.
The package README specifies no mandatory storage layout, so Health uses the lane's default
month partition. Explicitly created intermediate containers inherit the verified owner-only
Health ACL; the diary writes no ACL. The month follows the entry's local date. Timestamp edits
across months create the destination conditionally and delete the source with its ETag;
a source conflict rolls back the destination. Undo moves the entry back conditionally.
Listing reads only month containers overlapping the requested local range (inclusive start,
exclusive end), with at most six entry reads in flight. Foreign resources are skipped;
malformed/inaccessible entries are collected and shown as a small unreadable-entry count.
Timeline dates, pagination, search links and displayed times all use the user's local zone;
the package stores absolute dateTime instants. Each signed-in account shares a lazy month cache
across diary pages, the recent dashboard summary and search. Diary writes and diary notifications
invalidate it; unrelated Health writes do not. Meal edits retain product metadata and per-item
ingredients, and derive exposures from the preserved items.

Creates/restores use `If-None-Match: *`; updates and deletes require a strong `If-Match`.
A 412 re-reads: an identical RDF graph (apart from creation time on create retries), or an
already absent deletion, succeeds. Other conflicts surface to the user. Undo is another
conditional operation and never overwrites a concurrent change.

Patterns are descriptive co-occurrences, not tolerance conclusions or a diagnosis. Names/tags
are trimmed and case-folded; each meal counts once per food/tag and symptom type, with onset
inside the inclusive configured window (default 2–48 hours). Meals without a complete follow-up
window are excluded. Both meals with/without a following symptom and symptom-entry counts are
shown; each symptom URL counts only once per food/tag, even across overlapping meal windows.
At the fixed demo clock 2026-11-01T12:00Z, the oats/bloating row is 3 meals followed, 2 without,
2 distinct symptoms; porridge/headache is 2, 3, 1. Ingredients are searchable text,
not automatically inferred food names. The existing FHIR R4 exporter does not include diary data.
