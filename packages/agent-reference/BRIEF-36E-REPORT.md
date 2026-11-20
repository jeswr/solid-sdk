<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 36e review fixes

| Finding | Fix | Regression |
| --- | --- | --- |
| Part 3 registration and retained raw content | Email checks repetitions of retained content in `statement.bytes` alongside the existing statement-value check. Both text and UTF-8 byte arrays reach the recursive registration check before exact-text approval can authorize release. | `email.test.ts` queues exact approval, adds raw content with an inherited registration requirement and submits the approval. For both encodings, the data-terms verdict must be `fail / not-authorised`, the final decision must be `stop`, and the mailbox must stay empty. |
| Ledger recovery across rotation | The file ledger archives full segments as it writes. Before pruning, the runtime writes a checkpoint for each segment to be deleted, saves the head through the state store, then deletes oldest first. Each deletion can leave a prefix with its own checkpoint. | `email.test.ts` rotates past the retention bound, interrupts the state save and reopens twice. It verifies the previous head, the exported rows by sequence and hash, and the audit verdict. A separate test checks that a successful save prunes to the configured bound and the result still verifies on reopen. |
| G1 skipped bar | The main prefix reaches the main position of the last aligned passing decision before judgement, while preserving the existing positional bound. | `branch-comparison.test.ts` checks main `[pass A, bar B, pass C]` against branch `[pass C, new stop]`. The stop remains the judgement, and skipping the bar triggers the guard. |
| G2 copied DID step | The runner compares the authored steps in the configured main and patched branch before applying identity and settlement transformations. | `branch-comparison.test.ts` runs a DID scenario in which a copied application step sends to the aliased recipient before the branch's refusal. The extra release fails the guard. |
| A2 and W2 | An A2 judgement can witness an explicit `admit`. An explicit `go` goes through the ordinary witness requirement. | `branch-comparison.test.ts` requires disagreement for an explicit `go` on both a failed source check in an admitted run and a supersession check with no release. It also verifies the catalogue's admitted supersession judgement with its declared `admit` witness. |
| W standalone supersession | A supersession check can witness an ordinary decision only in its own received-message run. A2 binds a trailing standalone check to the preceding admission in the same script step. | `branch-comparison.test.ts` replays `records-to-new-practice`. Event 15 cannot witness admission 21 even though they share a gate run number. The next admission appears in the consequences. |
| Approval reuse | The scenario test pins the second question to Sam's agent and checks the rest of that agent's trace for sends or releases. | `usage-human-alternative.test.ts` requires two approval questions and no subsequent message, effect release or `go` from Sam's agent. |

The new production regressions reproduced the findings on the original implementation. For approval reuse, I added the same synthetic send after Sam's second question to temporary copies of the old and new tests. The old assertion passed and the new assertion caught the send.

## Manifest changes

| Path | Replay result |
| --- | --- |
| `mortgage-main/a2a-task-state-lies` under `transport-a2a` | G1 changes the row to `disagrees` with `changed before the judged decision`. It aligns branch admission 122 with main admission 213 at `terms-arrive`. The branch skipped main event 131 (`bank`, `ask-more / authority / assurance-insufficient`) and event 153 (`sams-agent`, `ask-principal / limits-approval / approval-required`). The measured guard outcome is `admit`. The transport regression independently requires the signed refusal's `pass / integrity / intact` verdict, its admission, the terminal refused state and no subsequent send in the conversation. |
| `records-to-new-practice/branch-1` under baseline | The row remains `runs` with `admit / fitness / superseded-by-better-source`. A2 judges event 15 in the standalone read. The separate admission at event 21 now appears in `consequences`. |

The full scenario matrix replay produced **283 paths, 277 runs, 1 disagreement and 5 blocked**. It executed all 278 paths with traces using the local sparq adapters. A parsed comparison against the original manifest found the two row changes above. The replay used scratch output, retained baseline outline comparison and left the six published aggregate trace hashes attached to their verified recordings. I reran both changed rows in their configurations and matched the recorded traces using their original commit metadata. The labels test names the specific disagreement and checks all 278 traces.

## Verification

- 142 distinct focused Vitest tests passed across the final runs with `--maxWorkers=2`. They cover the touched gates, runtime, ledger and comparison code, the affected transport, the catalogue, labels and both oracle checks. The snapshot test fixture needed a local scenario file for the exporter so it could exercise the intended projection.
- The live oracle passed with `ANSWERABLE_REQUIRE_LIVE_AGGREGATE=1`. The regenerated 163-path snapshot exactly matched the checked-in bytes with SHA-256 `4f63d12f5e58b1d4a2f085c3d524b671663a1d96dd61c45ee875838d1308922f`.
- Package typecheck, Biome lint, schema export check, workspace RDF discipline and the agent-layer guard passed. The package RDF pipeline reported **0 failures and 212 allowances**.
