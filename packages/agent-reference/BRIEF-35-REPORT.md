# Brief 35 proof integration

<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

Five of the nine requested paths now execute with real cryptographic verification. Four remain blocked by query admission or catalogue coverage. The added recycled-content branch with a supplier at 0.29 has the same catalogue blocker as its main path.

## Build and installation

Both packages were built from sparq commit `95c7b325476b3b0cf6ae69ca287926d05b6e87cd` with Node `24.22.3`, Rust `1.97.1`, and `wasm-bindgen` `0.2.122`. The query build rebuilt all 19 pinned catalogue entries and passed its `npm pack` prepack check. The result build checked the committed circuit and verification-key registry. Both host builds checked the bundled CRS pins. The sparq worktree has no tracked changes.

| Artifact | Version | SHA-256 |
|---|---|---|
| `sparq-org-zk-query-0.1.8.tgz` | 0.1.8 | `8b4bacb109c5f190e04565483c86c11efe3af5050b23ada80ab48512dbedc8b3` |
| `sparq-org-zk-result-0.1.8.tgz` | 0.1.8 | `42a52776b3046efab999d8555ea9e815175f1b2ac0dce3f2832e8905748410e0` |
| `nargo` | 1.0.0-beta.21 | `0852cd5631ac5ca25f744f25c931e3cff16351d9bcdbfb03cebb48a4494a0fe3` |
| `bb` | 5.0.0-nightly.20260324 | `d7621dfb151f55c23fb04bf274f366a6a1e0516b85a3cf0ae9165a9952509793` |

The artifacts and `SHA256SUMS` are in `/home/user/lanes/sparq-dist-1120`. Both native binaries were downloaded from the Linux x64 release URLs selected by the sparq workflow's bootstrappers. Their hashes and version commands matched the package pins. `sha256sum -c SHA256SUMS` passed for all four artifacts. The SHA-pinned installer unpacked both archives under the git-ignored `.sparq/` directory. `ANSWERABLE_SPARQ_ZK_QUERY` and `ANSWERABLE_SPARQ_ZK_RESULT` override the local package directories. The native query prover reads `SPARQ_NARGO` and `SPARQ_BB`.

`nargo compile` initially failed with `Failed to lock git dependencies cache: ... Read-only file system`. The successful retry provided a writable process home in the ignored sparq build directory. The catalogue builder also checks and rewrites verification keys. A local preload compared its proposed key writes with the tracked bytes and skipped identical writes. The first query archive installation hit `ENOSPC`. Retrying after removing disposable build caches succeeded with the same verified archive.

## Adapters and gate

- `sparq-zk-result/5` uses `testIssuerKeygen` and deterministic `testIssue`, validates the current verification report, and supplies `trustMembers` and authenticated status snapshots. Each result fixture puts the credential in its holder's wallet. The receiver admits issuer identity-signed key and status statements before accepting the evidence. The gate retains those policy records outside the core's task facts.
- The four hidden comparisons and introduction use the Brief 28 SELECT queries with filters moved inside their issuer's `GRAPH` as required by the scoped API. The date and integer limits remain unchanged. A boolean positive answer requires a verified row for the receiver's requested subject. Result proof bytes travel as bounded base64url so the RDF evidence projection can carry them. The adapter still accepts the native byte array on verification.
- `sparq-zk-query/1` is optional and keeps the research-grade, unaudited notice in discovery. The adapter reconstructs the native request from the verifier's stored query, nonce and policy. The gate derives the key list and roster from its source policy and pinned keys. Native issuance uses seeded test keys and a credential graph and proof configuration written with `n3.Writer`. The query proof's issuer list reflects the authorization roster. `complete` is available only when the receiver's policy pins the dataset commitment. The engine's query issuance currently covers basic credential graphs. Holder and status-list inputs for the full native envelopes require further wiring if the exact queries become available.
- Both methods fail closed when the replay store is missing. The gate claims the request before awaiting verification and persists consumption. A verified query `false` passes proof verification and causes the receiving gate to refuse the requested action. A verifier refusal retains its reason in the source trace.

Seeded issuance reproduces credential bytes. The proving libraries still generate fresh proof bytes, so a fresh run can change proof-bearing trace bytes while preserving the question, released result and decisions. The five traces contain neither credential graph bytes nor issuer seeds.

## Proof paths

| Scenario and path | Recorded outcome |
|---|---|
| `age-check/main` | **Runs.** `zk-result` verified the issuer-scoped hidden date comparison against 2008-11-13. The receiver admitted the result. |
| `degree-recognition/main` | **Blocked.** `zk-result` refuses the scoped `FILTER IN` with `operator outside positive BGP/JOIN/FILTER`. `zk-query` compiled the scoped BSc-or-MSc query to a plan absent from its catalogue. |
| `insurance-quote/main` | **Blocked.** The exact count-and-completeness query has no `zk-query` catalogue entry. The preferred `NOT EXISTS` variant omits the `xsd:` declaration. Adding that declaration for diagnosis still produces an uncatalogued plan. |
| `introduction/main` | **Runs.** Both directions produced verified `zk-result` proofs of the scoped identity flag. Both receivers admitted the result. |
| `recycled-content/main` | **Blocked.** The exact unscoped `MIN(?value) >= 0.3` query has no `zk-query` catalogue entry. The shipped MIN target scopes supplier graphs and adds two `COUNT` conditions. |
| `right-to-work/hidden-validity-proof` | **Disagrees.** `zk-result` verified the scoped hidden date comparison against 2026-11-13. The receiver admitted it as attested (`fit-for-use`). The retained expectation is `ask-more / assurance-insufficient`. |
| `tenancy-application/main` | **Runs.** `zk-result` verified the scoped hidden income comparison at 3000. The receiver admitted the threshold result and processed the separately attributed supporting statements. |
| `trial-eligibility/main` | **Blocked.** The exact age, diagnosis, medicine exclusion and completeness query has no `zk-query` catalogue entry. The shipped scoped query also replaces the completeness flag with period checks and has different per-node row bounds. |
| `visa-application/main` | **Runs.** `zk-result` verified the scoped hidden balance comparison at 10000. The receiver admitted the threshold result and processed the separately attributed supporting statements. |
| `recycled-content/supplier-below-threshold` | **Blocked.** The supplier fixture sets 0.29. The exact MIN query has the same missing catalogue plan, so the branch has no proof trace. A real catalogue ASK proof exercises the false-result path in the adapter tests. |

| Manifest | Runs | Disagrees | Blocked | Total |
|---|---:|---:|---:|---:|
| Before | 251 | 18 | 14 | 283 |
| After | 255 | 19 | 10 | 284 |

## Verification

The trace builds use `tsc -p tsconfig.build.json`, then the package's `node scripts/copy-generated.mjs` to populate the generated runtime modules. The standard runner records the selected scenarios with `--configuration=all` because these cases have no declared alternatives. The recorded traces contain six passing receiver `DER-17` proof checks and six passing `DER-18` issuer checks across the five executable paths.

| Check | Result |
|---|---|
| Query adapter Vitest file | 7 passed. Covers real true and false proofs, message refusal on verified false, a wrong issuer, replay, tampering, and missing package and replay store. |
| Result adapter Vitest file | 12 passed, including deterministic issuance, proof and issuer tampering, replay, and issuer and snapshot admission. |
| Scenario seam and catalogue Vitest files | 20 seam tests and 6 catalogue tests passed. |
| Oracle Vitest file | 1 passed. All 164 paths matched the unchanged fixture, with 158 executed live and six SHA-verified aggregate recordings. |
| Native query smoke test | The pinned `nargo` and `bb` produced a catalogue ASK proof, which the adapter verified. |
| Package typecheck and build compilation | Passed. |
| Package lint | Passed with zero errors, 417 warnings and 513 informational diagnostics. |
| Root RDF discipline and agent-layer guards | Passed. The RDF guard found zero failures against the existing baseline of 104 findings. |

The oracle fixture contains 164 paths and remains byte-identical to the starting commit, with SHA-256 `748c4955e9facabea0dc4c8eb912fb9bad66a89d8a5b25c795db321ced75aa5c`. The test uses the pre-Brief-35 method set. It runs the six aggregate paths live when their optional package is installed and otherwise uses the runner's SHA-verified aggregate recordings. The first focused oracle run found 158 paths with the aggregate package absent, which exposed the need for that fallback.

The shared-container restart interrupted the earlier full-suite and workspace-gate attempts. The full-suite log flagged the mortgage transport matrix test before the restart. The assertion details and baseline comparison were still pending at interruption. Post-restart verification ran `pnpm vitest run test/<file>.test.ts --maxWorkers=2` one file at a time and passed 46 tests across the five focused files. The orchestrator owns the full gate.

## Findings for sparq

- Publish catalogue plans for the exact three requested absence and totals queries, or agree on a scoped replacement with the maintainers and record the query change explicitly. The checks confirmed that the published scoped targets have their own valid catalogue entries.
- Add scoped typed `FILTER IN` to `zk-result` or catalogue the exact degree-membership query in `zk-query`.
- Add a caller-controlled native cache path. `nargo` currently needs a writable home even for the package's vendored circuit sources.
- Review the pinned `noir-lang/sha256` `v0.3.0` dependency's `build_msg_block_helper` constraint warning. `nargo` emitted it during the successful catalogue rebuild. This integration did not audit the circuit's soundness.
