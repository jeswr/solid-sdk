<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 37 integration report

The manifest has **283 paths, 274 runs, 4 disagreements and 5 blocked**. All 278 executable paths ran live.

## Review fixes

| Finding | Fix and verification |
| --- | --- |
| Agreement invocation missed record-backed credentials at the early check | `invokeUnderAgreement` passes the same evidence to initial authorization and message preparation. The payment-agreement regression puts the invocation under an approval rule and supplies an invoice marked record-backed without a corresponding audit record. The outbound gate stops at evidence with `evidence-invalid`, raises no approval question and sends no invocation. |
| Gate-only test could never observe core dispatch | `claim-failures.test.ts` runs the ruled insurance branch and checks the policyholder's outbound hold, the method and garage named in the request, and the absence of insurer events at that step. A second runtime fixture lifts the earlier bar and checks core dispatch from initial receipt through a structured retry. |
| Stale classifications | The focused usage, regulator and reputation tests require the measured outcomes for approval reuse, supplier terms, withheld entries and publication scope. `labels.test.ts` pins the regenerated counts. The capability, organizations and standing tests explicitly preserve the measured disagreements. |
| Missing artifacts | The full run regenerated the index and manifest. Both emergency branch-1 files and its index entry are removed. The five ZK paths and five Solid paths each have a current trace, outline and index row. |

## Regeneration

Commands ran from this package with Node 24.22.3. The pinned sparq aggregate, zk-query and zk-result adapters loaded from `.sparq`.

```sh
export PATH=/opt/node24/bin:$PATH
pnpm exec tsc -p tsconfig.build.json
node scripts/copy-generated.mjs
node scripts/export-schemas.mjs --check

for id in contract-wording emergency-access employment-reference flat-share hardship-request insurance-claim-photos probing-counterparty salary-benchmark age-check introduction right-to-work tenancy-application visa-application; do
  node scripts/run-scenarios.mjs --record-outlines --scenario="$id"
done

for cfg in data-access-by-reference-solid usage-control-solid-access-control identity-email-endpoint accountability-vendor-fault; do
  node scripts/run-scenarios.mjs --record-outlines --scenario=mortgage-main --configuration="$cfg"
done

pnpm run build
node scripts/oracle-snapshot.mjs
```

The build invokes the full scenario runner after compiling, checking schema exports and generating the reference traces. The scenario runner writes one configuration at a time to bound memory usage. Both trace generators resolve Git HEAD asynchronously because this environment returns `EPERM` from synchronous Git lookup. Newly generated traces use the worktree's resolved HEAD, `1b08e008ab6d11c3d3feb7d7ccb1e0aad7f4c2fa`.

The salary-benchmark branch was executed with the live aggregate adapter. Its trace has SHA-256 `2d03855c3aeb73614b02a33a9fa3a14f827e5abd309728885daf6b26935a0f60`. The other five aggregate recordings matched the live decision projections and retain their original bytes and pinned hashes. The 35 header-only updates fill previously unknown commits. Every indexed trace has a known commit and its indexed event count matches its file. The aggregate contributor count remains an upper bound because a slot that is eligible to contribute can still commit zero.

The five ZK paths are `age-check/main`, `introduction/main`, `right-to-work/hidden-validity-proof`, `tenancy-application/main` and `visa-application/main`. The five Solid paths are the main path and `grant-wider-than-terms` and `read-after-withdrawal` under `data-access-by-reference-solid`, and the main path and `translation-grants-more` under `usage-control-solid-access-control`.

## Oracle comparison

The old snapshot was copied to `/tmp/brief37/pre-rdf-old.json`. I parsed both files and used Node's `isDeepStrictEqual` over the union of their keys. There are 164 old paths and 163 new paths. The following eight keys differ, with 156 equal and no added keys.

| Key | Measured change |
| --- | --- |
| `contract-wording/branch-1` | The branch asks about acceptance and records the principal's denial. |
| `emergency-access/branch-1` | Removed. |
| `employment-reference/branch-1` | The branch reads and cites the score. Fitness stops with `method-not-accepted`. |
| `flat-share/branch-1` | The principal denies trust and the gate refuses. |
| `hardship-request/branch-1` | The principal declines to send the diagnosis and the action stops. |
| `insurance-claim-photos/branch-1` | The garage letter is held locally and the policyholder's agent asks for structured evidence at fitness. |
| `probing-counterparty/tenth-request` | The probes are admitted and ten proposed actions stop at mandate. |
| `salary-benchmark/branch-1` | The first employer stops at data terms before contributing. The second employer also stops. |

- Old SHA-256 `748c4955e9facabea0dc4c8eb912fb9bad66a89d8a5b25c795db321ced75aa5c`
- New SHA-256 `4f63d12f5e58b1d4a2f085c3d524b671663a1d96dd61c45ee875838d1308922f`

## Rows outside `runs`

| Path | Status | Measured result |
| --- | --- | --- |
| `degree-recognition/main` | blocked | @sparq-org/zk-result rejects the issuer-scoped FILTER IN membership with "operator outside positive BGP/JOIN/FILTER". @sparq-org/zk-query has no catalogue plan for the scoped BSc-or-MSc query. |
| `emergency-access/branch-2` | disagrees | `stop` / `source-unknown` / `mandate`. The inbound source check fails with `source-unknown` at event 35. The outbound mandate check fails with that reason at event 37 and the gate stops at event 38. Rule W rejects the cross-gate pairing. |
| `insurance-quote/main` | blocked | @sparq-org/zk-query reports "missing catalogue plan" for the exact count-and-completeness query. The preferred absence alternative lacks an xsd prefix and has no catalogue plan even with the prefix declared. |
| `master-data-change/branch-2` | disagrees | `refuse` / `source-not-authoritative` / `source`. Inbound source fails at event 2 and refuses at event 4. The finance agent then stores other admitted statements before outbound evidence fails at event 28. The continuation check flags those stores. |
| `pay-an-invoice/branch-1` | disagrees | `refuse` / `source-not-authoritative` / `source`. Inbound source fails at event 2 and refuses at event 4. The business agent then sends an agreement acceptance and stores invoice evidence before outbound P4 fails at event 83. The continuation check flags the later send and stores. |
| `recycled-content/main` | blocked | @sparq-org/zk-query reports "missing catalogue plan" for the exact unscoped MIN query at 0.30. Its published target also requires issuer-scoped graphs and two COUNT conditions, so the exact query cannot release either boolean. |
| `recycled-content/supplier-below-threshold` | blocked | @sparq-org/zk-query reports "missing catalogue plan" for the exact unscoped MIN query at 0.30. Its published target also requires issuer-scoped graphs and two COUNT conditions, so the exact query cannot release either boolean. |
| `supplier-onboarding/branch-2` | disagrees | `refuse` / `source-not-authoritative` / `source`. The supplier agent's inbound source check fails at event 9 and refuses at event 11. The agent then stores the separate certificate at event 18 before outbound fitness fails at event 21. The continuation check flags the later store. |
| `trial-eligibility/main` | blocked | @sparq-org/zk-query reports "missing catalogue plan" for the exact age, diagnosis, medication exclusion and completeness query. The published scoped target changes the query and its per-node bounds. |

## Checks

- Package build and schema export check passed. The build reported 278 live executions.
- Focused comparator, transport, runtime, later-bar and review regressions passed across 12 files and 103 tests. Restoring the old agreement invocation for its regression produced `ask-principal / approval-required`; the fixed call produced `stop / evidence-invalid`.
- Focused service, trust, standing, payment and proof seam coverage passed across 11 files and 67 tests.
- The oracle test passed with `ANSWERABLE_REQUIRE_LIVE_AGGREGATE=1`. The independent parsed comparison also passed after regenerating the artifact.
- The final labels, engine, recorded-joint and precedence tests passed across four files and 22 tests.
- Typecheck and Biome lint passed. The RDF pipeline reported zero failures and 212 explicit remaining violations.

## Changed paths

- Source and generators. `src/engine/compare.ts`, `src/engine/run.ts`, `src/gates/outbound.ts`, `src/mechanisms/dataset-query.ts`, `src/mechanisms/forum.ts`, `src/mechanisms/single-use.ts`, `src/runtime/agent.ts`, `scripts/generate-traces.mjs`, `scripts/oracle-snapshot.mjs`, `scripts/run-scenarios.mjs`.
- Scenario data and embedded outlines. `scenarios/contract-wording.json`, `scenarios/employment-reference.json`, `scenarios/flat-share.json`, `scenarios/hardship-request.json`, `scenarios/insurance-claim-photos.json`, `scenarios/probing-counterparty.json`, `scenarios/right-to-work.json`, `scenarios/salary-benchmark.json`.
- Focused tests. `test/approval-release.test.ts`, `test/branch-comparison.test.ts`, `test/capabilities-b-adversarial.test.ts`, `test/capabilities.test.ts`, `test/catalogue.test.ts`, `test/claim-failures.test.ts`, `test/engine.test.ts`, `test/labels.test.ts`, `test/later-bars.test.ts`, `test/oracle.test.ts`, `test/organizations.test.ts`, `test/regulator-claim-alternative.test.ts`, `test/reputation-post-alternative.test.ts`, `test/settlement/payment-journeys.test.ts`, `test/standing.test.ts`, `test/transport-bindings.test.ts`, `test/usage-human-alternative.test.ts`, `test/vendor-fault-alternative.test.ts`.
- Generated data. `scenario-runs.json`, `traces/index.json`, `test/oracle/pre-rdf.json` and the trace and outline files. The git diff includes 274 trace files and 23 outline files.
- Reports. `ENGINE-REPORT.md` and `BRIEF-37-REPORT.md`.

Changes remain in the working tree. The orchestrator owns the full workspace gate and the catalogue and explorer updates.
