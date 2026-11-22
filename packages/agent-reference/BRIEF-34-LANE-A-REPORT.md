<!-- AUTHORED-BY Codex GPT-6 -->

# Brief 34 Lane A report

Lane A keeps Brief 15’s ordered, consuming decision match first. When it finds no difference, the comparator checks A1 through A4 in order. Manifest comparison treats inbound `refuse` as catalogue `stop` and inbound `admit` as catalogue `go`. A branch with a runnable main path and no divergence is a disagreement under every configuration, including `onlyUnder`. A branch with a blocked main keeps Brief 15’s standalone judgement.

## Paragraphs for Lane C

**A1.** The old comparator could see an added refusal but missed the removal of a main-path bar. It now performs the ordered match in the other direction for `go` or `admit` expectations and requires the witnessed agent to send a message or execute an effect after the witness. A release already in the shared prefix does not qualify. The `false-but-signed/branch-1` row runs at `go / source-accepted / source`. Tests distinguish a real release, a stop expectation, a copied prefix, and a run where the main had no missing bar.

**A2.** Statement checks were invisible when the message was admitted. The comparator now locates withholding checks inside admitted inbound runs and consumes matching checks from main in order. It keeps the check’s actual verdict and reason and reports the row’s outcome as `admit`. It also handles standalone precedence, where the inbound gate emits the supersession check immediately after recording admission of the competing statements. The tests cover a new failure, a matching failure, a repeated failure, ordinary fitness pass, outbound approval, and the supersession reason. The six mortgage rows below retain their registered outcomes and reasons. `records-to-new-practice/branch-1` now has a real difference at `admit / superseded-by-better-source / fitness`. Its old `ask-more` catalogue expectation still disagrees in Lane A. Lane C’s ruled `go` expectation agrees through the normalization.

**A3.** Transport records can carry an optional scenario fault slug. The A2A text part and task-state records are tagged where the parser drops the part or the gate ignores the substituted state. The MCP record is tagged when the injected description is dropped, and the origin verifier tags a pointer that differed from the register address and was ignored. The comparator recognizes a slug absent from the main transport records and keeps the branch’s witnessed outcome. The three paired outline comparisons are equal entry for entry after filtering the fault records. On `a2a-task-state-lies`, Sam’s agent admits the signed refusal, the script asserts that the conversation phase is `refused`, and the trace contains no subsequent message from Sam’s agent in that conversation. Ordinary records have no marker. The oracle projection omits the field. The JSON Schema exporter declares the optional slug using the existing passthrough trace schema, which already preserves it at runtime.

**A4.** Two matching gate tuples can ask a principal about different actions. The engine associates events with the producing script step by sequence number, since several script steps can share a displayed step number. It compares the declared action fields, sorted statement identifiers and effect decision, with conversation IDs, digests and nonces excluded. A reference to a scripted reading stays a stable script reference. `health-referral/branch-1` is judged at the hold of the full record, and the test checks that no released packet contains that statement. The tests run genuine copies of the `contract-wording` and `employment-reference` main scripts and confirm they do not diverge. An inbound hold uses the receive step without its scripted core reply because that reply has yet to run. This keeps the truncated `flat-share` branch a disagreement until Lane C adds the trust denial. A4 also recognizes the diagnosis in `hardship-request`; the denial and approval text are separately owned by Lanes C and B.

**A5.** A branch can name a scenario agent in `judgedAgent`. Another agent’s non-passing decision may be skipped only for an outbound approval ask whose exact held action was approved and went. The driver links a newly held action digest to its ask and checks for the same agent’s signed reply and first release decision in the approval call. The skipped events stay in the trace and outline and are listed in manifest `setup`. With `judgedAgent: "receiver-agent"` applied in the trip-booking test’s own world, the result is `stop / not-authorised / mandate` and the hotel’s approved `ask-principal / context-not-clear` appears in `setup`. Judging the hotel in that test throws when it would skip the traveller’s stop. Unit coverage also checks that the judged agent’s own ask remains eligible and that an unapproved ask cannot be skipped.

## Starting scenarios that differ from the brief

At `f49f157d2`, `scenarios/contract-wording.json` already changes `params.decision` from `review-clause` to `accept-unknown-clause`. `scenarios/employment-reference.json` changes it from `review-reference` to `reject`. Both checked-in branches therefore diverged under A4 in direct runs, at a `limits-approval` check with verdict `ask-principal` and reason `approval-required`. The brief’s no-divergence assertion holds for actual copies. The maintained scenario and manifest changes remain in Lane C.

## Measurements for Lane C’s table

| Ruling and path | Outcome / reason / check | Status and change |
|---|---|---|
| 1 `contract-wording/branch-1` | `ask-principal / approval-required / limits-approval`, check verdict `ask-principal` | A4 sees the existing `accept-unknown-clause` decision. Lane C owns the ruled scenario change. |
| 3 `employment-reference/branch-1` | `ask-principal / approval-required / limits-approval`, check verdict `ask-principal` | A4 sees the existing `reject` decision. Lane C owns the ruled scenario change. |
| 4 `false-but-signed/branch-1` | `go / source-accepted / source` | Runs through A1. |
| 6 `hardship-request/branch-1` | `ask-principal / approval-required / limits-approval` | A4 can distinguish the diagnosis. Lane B owns the approval text, and Lane C owns the denial. |
| 7 `health-referral/branch-1` | `ask-principal / approval-required / limits-approval` | Runs through A4. |
| 10 `records-to-new-practice/branch-1` | `admit / superseded-by-better-source / fitness`, check verdict `pass` | A2 finds divergence. Lane C owns the catalogue correction. |
| 12 `trip-booking/branch-1` | `stop / not-authorised / mandate` | Runs through A5 in the test’s patched world. Lane C adds the field to the maintained branch. |
| 13 `stranger` | `admit / source-unknown / source`, check verdict `fail` | Runs through A2. |
| 14 `index-shows-two-histories` | `admit / evidence-invalid / source`, check verdict `fail` | Runs through A2. |
| 15 `chain-with-a-gap` | `admit / lookup-failed / source`, check verdict `indeterminate` | Runs through A2. |
| 16 `federation-business-only` | `admit / source-not-authoritative / source`, check verdict `fail` | Runs through A2. |
| 17 `high-score-not-registered` | `admit / source-unknown / source`, check verdict `fail` | Runs through A2. |
| 18 `certificate-does-not-cover` | `admit / stale-data / fitness`, check verdict `fail` | Runs through A2. |
| 19 `a2a-text-part-instruction` | `go / evidence-complete / evidence` | Runs through A3. |
| 20 `mcp-tool-description-poisoned` | `go / evidence-complete / evidence` | Runs through A3. |
| 21 `address-from-the-message` | `admit / source-accepted / source` | Runs through A3. |
| 22 `a2a-task-state-lies` | `admit / intact / integrity` | Runs through A3. |

**Ruling 9 driver handoff.** The plain `message` driver in `src/engine/run.ts` attaches scenario statements as credentials. The existing `invoke-agreement` step calls the runtime’s `invokeUnderAgreement` path, which adds the sender’s own signed representation. In memory I converted the ten `probe-N` steps to `invoke-agreement`, retaining their conversation, operation, purpose and input. All ten incoming probes carried authority evidence and were admitted. The trace had ten mandate stops and zero inbound refusals by the person’s agent. The row ran at `stop / not-authorised / mandate`. This uses the existing driver and gate code.

## Verification

- Node 24 was selected from `/opt/node24/bin`. The workspace dependencies were built before running the tests.
- Red on the starting source, `pnpm exec vitest run test/branch-comparison.test.ts`. Eight failed and six passed. The new comparator rules, live full-record result and `judgedAgent` field were absent.
- After the restart, `pnpm exec vitest run --maxWorkers=2 test/<file>.test.ts` passed in four separate runs with the aggregate package absent. Results were 19 comparator tests, 16 transport binding tests, 1 origin-hosted test and 3 recorded-joint tests. An earlier run surfaced a false A4 difference from a dormant scripted reply on the flat-share hold. The engine now excludes that reply from the inbound descriptor, and its regression passes.
- Direct replay of the six mortgage A2 pairs and the records-to-new-practice pair against the comparator confirmed all seven check verdicts, reasons and checks in the table.
- The scratch manifest replay completed 81 canonical oracle paths before the container restart. All 81 projected traces equalled the pinned oracle. The maintained manifest has 283 paths, with 251 runs, 18 disagreements and 14 blockers. Lane C will regenerate it after applying the scenario and expectation rulings.
- A focused real-package run reached the release and hidden-total threshold test, which timed out under concurrent load. Its isolated retry passed with the same pinned package installed under `/tmp`. The container restart interrupted the broader native retry.
- Package typecheck, package lint and `node scripts/export-schemas.mjs --check` passed. The RDF pipeline reported 0 failures and 213 existing allowances. Root codegen and agent-layer guards passed.
- The worktree changes are limited to the owned source and test files, the schema exports, and this report. The orchestrator runs the full gate on the integrated tree and Lane C checks the final 282-path manifest and eight-key oracle delta there.
