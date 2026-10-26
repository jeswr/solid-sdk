<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-11 questions

1. **DESIGN §2 D4: federation constants.** The ontology package has no runtime
   constants export. Options: expand the existing CON-02 constants bridge, or
   introduce a new runtime API/dependency. Conservative choice: expand
   `core/federation-vocab.ts` using the exact checked-in sector IRIs; leave the
   package/API switch to CON-13. No dependencies added.
2. **DESIGN §2 D4: sector coverage.** Health has no workout event class; media
   has no Book or VideoGame specializations, and finance distinguishes a
   transaction record from a money-movement event. Options: invent narrower
   terms/event identities, or use existing broad record/work classes.
   Conservative choice: type the Apple Health document as `health:HealthRecord`,
   retain workout `schema:ExerciseAction`, use `media:CreativeWork` for books,
   games and conversation documents, and `fin:TransactionRecord` for imported
   financial lines. Uber journeys retain `schema:TravelAction`; fares gain the
   finance type. Preserve existing source properties, categories and registration
   classes rather than invent clinical measurements, monetary events or people.
3. **DESIGN §2 D3 / CON-11 streaming:** options are changing the legacy document
   layout to streamed shards, or streaming the input while retaining existing
   capped RDF snapshots. Conservative choice: stream records into the existing
   deterministic documents, retaining the 64 MiB/100,000-record limits and
   replacement behavior. Native `File.stream()` is preferred; existing text-only
   host/test implementations remain supported. RDF output remains row-bounded,
   not constant-memory. No source cursor is invented for an export file.
