<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 37b integration report

The updated manifest has **283 paths, 278 runs, 0 disagreements and 5 blocked**. All four targeted branches now agree with their catalogue outcomes.

| Path | Measured outcome / reason / check | Status |
| --- | --- | --- |
| `emergency-access/branch-2` | `stop` / `source-unknown` / `mandate` | runs |
| `master-data-change/branch-2` | `refuse` / `source-not-authoritative` / `source` | runs |
| `pay-an-invoice/branch-1` | `refuse` / `source-not-authoritative` / `source` | runs |
| `supplier-onboarding/branch-2` | `refuse` / `source-not-authoritative` / `source` | runs |

The emergency expectation points to the outbound mandate check. The other three expectations still judge the original inbound source refusal. For a standalone refusal, the replay guard associates the decision with the signed statement ID offered in that gate run. A later store requires its own admission, and a send requires its own matching outbound release. The guard rejects the refused item in stores, packets, outbound action scope and effect support. Tests verify that a refused message followed by an unrelated store or an otherwise valid send still fails.

## Rows outside `runs`

| Path | Status | Measured blocker |
| --- | --- | --- |
| `degree-recognition/main` | blocked | sparq #7412. `zk-result` rejects the issuer-scoped `FILTER IN` with an operator error, and `zk-query` has no plan for the scoped BSc-or-MSc query. |
| `insurance-quote/main` | blocked | sparq #7412. `zk-query` has no plan for the exact count-and-completeness query or for the absence alternative with its `xsd` prefix declared. |
| `recycled-content/main` | blocked | sparq #7412. `zk-query` has no plan for the exact unscoped `MIN` query at 0.30. The published target also requires issuer-scoped graphs and two `COUNT` conditions. |
| `recycled-content/supplier-below-threshold` | blocked | sparq #7412. `zk-query` has no plan for the same exact unscoped `MIN` query at 0.30. |
| `trial-eligibility/main` | blocked | sparq #7412. `zk-query` has no plan for the exact age, diagnosis, medication exclusion and completeness query. The published scoped target changes the query and its per-node bounds. |

## Regeneration and verification

The commands ran from `packages/agent-reference` with Node 24. The replay loaded `sparq-aggregate/1`, `sparq-zk-result/5` and `sparq-zk-query/1` from the git-ignored `.sparq` directory.

```sh
export PATH=/opt/node24/bin:$PATH
pnpm exec tsc -p tsconfig.build.json
node scripts/copy-generated.mjs
node scripts/export-schemas.mjs --check
node /tmp/brief-37b/focused/run-scenarios.mjs
node /tmp/brief-37b/focused/apply-reviewed-rows.mjs
node /tmp/brief-37b/check-refusal-paths.mjs
node scripts/oracle-snapshot.mjs /tmp/brief-37b/pre-rdf-regenerated.json
```

The scratch runner used `scripts/run-scenarios.mjs` with writes redirected to `/tmp/brief-37b` for the four affected trace and outline pairs and the candidate manifest. It replayed the 11 baseline paths for the four affected scenarios with outline comparison enabled. Comparing parsed rows by path and configuration found exactly four changes in the manifest. The applied rows changed `disagrees` to `runs` and dropped the disagreement note. Their recorded decisions, expected outcomes and consequences were equal. Each generated outline was byte-equal. Each generated trace differed only in `generated.commit`, which resolved to `458d21958e1423bcac0250bb461891ba42ad30c4` in the scratch replay. The existing traces, outlines, index and recorded aggregate hashes were retained.

I scanned all 278 manifest traces for inbound refusals without a matching `message-in` in the same agent's gate run. The scan identified 17 candidates across 15 scenario and configuration pairs. The live replay of those pairs checked 39 rows against the updated manifest, including their statuses, actual and expected decisions, consequences, setup and notes. All matched. I stopped the additional full-matrix replay after the scoped checks and live oracle passed.

I parsed the regenerated oracle and the `ed1df480d` snapshot and compared all keys and their projections with `isDeepStrictEqual`. All **163** keys matched. The regenerated, checked-in and original files also had identical bytes and SHA-256 `4f63d12f5e58b1d4a2f085c3d524b671663a1d96dd61c45ee875838d1308922f`. The oracle test independently replayed with `ANSWERABLE_REQUIRE_LIVE_AGGREGATE=1`.

## Checks

- All 82 focused tests passed with `vitest run --maxWorkers=2`. They cover the standalone refusal guard, the four affected scenarios, outbound stop behavior, the labels manifest counts and the live oracle.
- Typecheck, Biome lint, schema export and workspace RDF discipline passed. The package RDF pipeline reported 0 failures and 212 explicit remaining violations.

The worktree changes include the engine guard, the emergency expectation, focused tests, the four manifest rows and the two reports. No commit was made.
