<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Google Health (CON-A4)

CON-A4 adds `google-health` as Fitbit's Google OAuth successor. Read its README section
and `src/google-health/api.ts` before changing it. Every Health endpoint, filter, field,
unit and scope stays in that one module and quotes its source, the v4 discovery document
(revision 20261110). Anything that document does not state keeps a VERIFY note. Never
reintroduce a synthetic payload profile. The types are `steps`, `distance` and
`total-calories`, which use `:dailyRollUp` (POST, civil-date range, `windowSizeDays: 1`, page
size 90/14, at most 90 or 14 days). The others are listed: `heart-rate` and `weight` by
`{type}.sample_time.physical_time`, `exercise` by `exercise.interval.civil_start_time` widened
by 14 h, and `sleep` by `sleep.interval.end_time`. Exercise and sleep pages hold 25. Never
mix physical and civil bounds in one filter. Times are nested (`sampleTime`, `interval`), int64
values may be digit strings and offsets are Duration strings. `parsePoint`/`parseRollup`
separate an unrecognised `shape` from an invalid `value`. A proto3-omitted default is never a
shape: an absent `exerciseType` is `EXERCISE_TYPE_UNSPECIFIED` (imported), and an absent
`displayName` or stage type is a value refusal. Shape is judged per type across the run: more
than 10% of at least 20 points, or all of at least 3, stop only that type before writing the
crossing window, keep its checkpoint unchanged and warn `[google-health:unrecognised-shape]`.
Never fail the whole run for it. Invalid values (0 bpm, unknown enums, stages outside their
session) are skipped. Shared Google OAuth
accepts `health`; never reuse Fitbit tokens.
`TokenSet.scope` keeps the granted scope string; `SourceAuth.scopes` carries it to
`ctx.scopes` through runImport, and the adapter refuses partial grants. Hosts use the adapter's
`createSourceAuth` hook for one 401 refresh. Its transport forwards GETs plus only a bounded
JSON-string `dailyRollUp` POST to the Health origin, and strips `X-HTTP-Method-Override`,
`X-HTTP-Method` and `X-Method-Override` from every forwarded request. Map a 401 that survives the refresh, and
any 403 without a rate or quota reason, to `IntegrationAuthError` with re-authorise guidance.
Map a rate or quota 403 like a 429: retry, then `RateLimitedError`. Preserve transport
isolation, redirect refusal, byte caps, abort signals and memory-only tokens.
The standard writer, `adapterContainerUrl` and the Node state store (`connectorStorageId`)
deliberately resolve Google Health into the legacy `integrations/fitbit/` container. The
checkpoint lives in `state-google-health.json` beside Fitbit's untouched `state.json`; custom
writers must do the same. A Google session updates a legacy Fitbit row in place on any of
these: the same stored resource URL; a numeric id equal to the `logId` with starts within
14 h and the same wall clock or kind; the same UTC start and name; or the only legacy row at
the same wall clock to the second, whatever its name. v4 display names are generated
("Running" for a Fitbit "Run"), so never require names to match. Several rows at one wall
clock are told apart only by kind: the same name, or the Fitbit name → documented v4
`exerciseType` table in `mapping.ts` (`FITBIT_EXERCISE_TYPES`; its Fitbit names are VERIFY).
The wall clock comes from `civilStartTime`, else `startTime` plus `startUtcOffset`, and never
from the string's own offset. Otherwise a named session keeps `google-health-exercise-<id>`, so an
unrelated `logId` never blocks it. Ambiguous or repeated matches are skipped and counted with
an `onWarning` note; never guess them, and never throw for them. Key sleep by resource name
when present. Fitbit remains a deprecated fixture/demo oracle, excluded from the
new-connection catalog and refused by live runner/CLI. No Fitbit file path existed here.
List types walk one UTC day per window, chronologically, writing after each window. Daily
totals walk civil-date ranges up to UTC+14's today. First imports reach back `lookbackDays`
(30). The version 3 checkpoint keeps per-type `through` and `fetchedAt` and re-reads 48 h;
for totals, `through` is the last civil date that has ended everywhere. A version 1 or 2
checkpoint restarts at the lookback window. Points more than 48 h late are missed by design.
Per-type and per-run RunBudgets end the run successfully at the last written window. Only a
type whose first window cannot fit, or a real error, fails. A window at `maxPages` splits:
list windows into 12/6/3/1 h, rollup ranges by halves down to a day. Only the smallest window
over the cap stops that type, with a warning, and never fails the run. Hold a type at a window
only for points that can still change: an unfinished exercise (ending after the clock) that
started within 48 h or ends within 6 h after the clock, or an unprocessed sleep that ended
within 48 h. Older ones are final: write them as reported, never hold, and warn
`[google-health:stale-unfinished]` / `[google-health:stale-unprocessed]`. Ignore a point dated
after the clock (a later window owns it). A rollup 400 naming the range or its end is retried
once with the range ending the day after the run's UTC date. Documents
are day-partitioned. Heart rate is aggregated per minute (mean/min/max/`health:sampleCount`,
all sources), at most 1,440 entries per UTC day. Weight keeps per-source samples per UTC day.
Daily totals are named by the rollup's civil date; no UTC instant is invented. Sample keys
include the data source. Same-key conflicts resolve by latest `updateTime`, then the larger
value, never throwing. Preserve response/point/stage/token/page caps, bounded 429/5xx backoff,
abortable waits, deterministic upserts and conditional ETags. Demo fixtures, instants and civil
dates alike, shift by whole days into the lookback. Test against `syntheticHealthApi` in
`test-support/google-health-api.ts` (not shipped or exported), which rejects undocumented
requests. Other Health types and source
deletions are outside this import. All fixtures remain synthetic.
