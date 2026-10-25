<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Health model (HLT-00)

Import from `./index.js`. This layer has no UI, session, global fetch or SDK facade dependency.
The typed entities and GPX scanner are ported from `apps/pod-health`; namespace constants and
read aliases come from `@jeswr/suite-vocab`. The original deployable is unchanged.

- `HealthDocument`, `parseHealth`, `toTurtle`: mutable typed RDF documents. Turtle writes reject
  named graphs and unsafe IRIs; unknown data, resource identities and literal contents survive.
- `addMeasurement`, `measurements`, `aggregateMetric`: canonical QUDT/UCUM values for steps,
  heart rate, sleep duration, weight and systolic/diastolic pressure. Clinical codes use
  `health:CodeableConcept`; effective dates use `time:Instant`. Dates and shard keys use UTC.
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
- `createHealthStore(fetch, storageRoot, owner)`: pod-scoped, redirect-refusing I/O. Use
  `initialize()` to create the fixed layout; mutations also initialize it. WAC ACL links are
  required; existing ACLs must be owner-private. A failed privacy setup blocks sensitive writes,
  including on retry. Each mutation uses `If-None-Match: *` or a strong ETag. Conflicts surface as
  `HealthIoError` with status 412; read errors retain `RdfFetchError` status. Missing list/shard
  documents are empty; other errors propagate. `write()` is the low-level conditional writer for
  existing paths and caller-batched documents; initialize containers before creating documents.
- Store operations: `addObservation(id, sample)`, `metric(kind, range)`,
  `saveRecord(id, input, precondition)`, `loadRecords(kind)`, `importGpx(id, xml)`,
  `loadWorkouts()`, `read(path)`, `write(path, document, precondition)`, `migrate(path)`.
  `migrate` rewrites vocabulary in an explicitly supplied existing resource once; repeat calls
  perform no PUT. Discovery of resources to migrate stays with the caller.

HLT-01 supplies hooks, subscriptions, Type Index discovery/registration, offline caching/outbox
and UI. This model does not assume their APIs. No new vocabulary terms or dependencies on the
old private deployable are introduced.
