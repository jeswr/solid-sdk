<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# HLT-00 conservative interpretations

1. **Workout vocabulary** (07-parity-backlog, Health / Data mapping): the sector has no workout or route classes. Options: invent sector terms or retain the existing canonical `NS.POD_HEALTH` workout/route model. Retain the existing model, and read connector `schema:ExerciseAction` records through typed accessors. No ontology changes in this lane.
2. **Aggregation policy** (HLT-01 acceptance): timezone, week start and metric reducers are unspecified. Options include caller-local or UTC buckets and sum or average. Use UTC days and ISO Monday weeks; sum steps/sleep durations and average sampled vitals/weight. Keep units separate; no implicit unit conversion in aggregation. Ranges are start-inclusive/end-exclusive.
3. **Migration and grep scope** (HLT-01 acceptance vs model-first amendment): a repository-wide ban would remove the required legacy aliases and fixtures in unrelated projects. Limit the grep assertion to the new health model and its tests; generate legacy fixture IRIs from suite-vocab aliases. Migrate supplied resources in place, conditionally, once per resource (a second run detects no legacy vocabulary and writes nothing).
4. **Apple export retention** (Health / Open points): retain derived observations only, stream extracted XML, and do not upload the source XML. Unsupported record kinds are skipped; malformed supported records fail explicitly.
5. **Container privacy** (Health / Data mapping; model-first): use the existing WAC typed model with owner Read/Write/Control and inherited defaults. Require an explicit advertised ACL link and fail before any health data write if it is absent; do not guess ACP policy URLs or silently fall back to inherited public access.
