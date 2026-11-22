# Brief 36p — agent-reference tests with optional sparq adapters

<!-- AUTHORED-BY Codex GPT-6 -->

`scripts/run-scenarios.mjs` gets its registry from `availableAdapters()`.
The adapter loaders honor `ANSWERABLE_SPARQ_AGGREGATE`,
`ANSWERABLE_SPARQ_ZK_RESULT`, and `ANSWERABLE_SPARQ_ZK_QUERY`, defaulting to
the package-local `.sparq` directory. The engine checks each path's
`requiredMethods` against that registry after applying its configuration
and branch changes. The affected tests use the same registry. The query
adapter adds no missing-package rows in this scenario matrix.

Five baseline paths need `sparq-zk-result/5`. When the adapter is absent,
their manifest rows must have status `blocked`, no trace, and the exact
reason `needs a proof system: needs the sparq-zk-result/5 package, which is not installed`.

- `age-check/main`
- `introduction/main`
- `right-to-work/hidden-validity-proof`
- `tenancy-application/main`
- `visa-application/main`

Six live paths need `sparq-aggregate/1`. The engine reports
`needs joint computation: needs the sparq-aggregate/1 package, which is not installed`
for each when the adapter is absent. The runner verifies their recorded
traces by SHA-256 and keeps the six rows in the manifest's trace count.

- `cohort-count/main`
- `cohort-count/branch-1`
- `cohort-count/branch-2`
- `platform-income/main`
- `salary-benchmark/main`
- `salary-benchmark/branch-1`

The labels test still checks every produced trace and now names all expected
blocked paths. It also corrects the stale invoice disagreement assertion.
The committed manifest at `89db35cf0` records `pay-an-invoice/branch-1`
as agreeing and has zero disagreements.

The live model corpus still checks all 26 recorded carriage requirements
with the aggregate adapter installed. Eleven entries are invokes from
`cohort-count/main`, `cohort-count/branch-1`, `platform-income/main`, and
`salary-benchmark/main`. The test names each message and expects zero
occurrences when the aggregate adapter is absent. The engine test
asserts all live missing-package reasons and continues to check the
recorded aggregate hashes. Both right-to-work tests assert the missing
result proof reason when needed and keep their live proof assertions when
the adapter is available. The selective test checks ordinary disclosure
and passport refusal in both modes.

## Verification

I used Node 24.22.3 and ran the focused suite from the package directory.

```sh
vitest run --maxWorkers=2 test/{complete-model,labels,selective,engine,later-bars}.test.ts
```

With the local adapters installed, all 26 tests passed against the
committed 278-trace manifest. The package typecheck and the changed-file
Biome check at error level passed.

The runner has no output-directory option. I regenerated into a scratch
package copy without `.sparq`, with its own manifest, traces, and outlines.
The runner reproduced the CI counts.

```text
267 live data paths ran; manifest: 273 runs, 0 disagree, 10 blocked
6 recorded real joint paths retained after SHA-256 verification; package absent, no live rerun.
```

I moved the checkout's `.sparq` directory aside for the five-file
adapter-free run and restored it afterward. Four files passed that run.
The model test exposed additional aggregate capacity entries, which I
matched against the recorded aggregate traces. The final model test
passed on rerun against both the committed 278-trace manifest with
adapters installed and the regenerated 273-trace manifest without
adapters. All 26 focused tests passed in both environments across the
suite runs and the model rechecks.

All regeneration wrote to scratch. A Git diff against HEAD confirmed
that runtime code, runner scripts, scenarios, the oracle, the committed
manifest, traces, and outlines match the checkout at `89db35cf0`.
