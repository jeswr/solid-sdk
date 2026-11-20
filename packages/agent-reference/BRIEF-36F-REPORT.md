<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 36f report

## Ruling 34d and round 6

| Finding | Fix and regression coverage |
| --- | --- |
| G1 counts steps the branch cannot reach | G1 uses the effective script IDs. It also counts a step that produced a branch trace event, even if the step ID is absent from the script set. Dropped main bars are reported as `notReached`. The comparator tests cover an omitted step, a step retained in the script, a step attributed in the trace, and an extra release from an unchanged step that still fails G2. The transport test verifies the signed refusal is admitted, the conversation stays refused, and Sam's agent sends nothing further in it. |
| G1 allows a later identical bar to cover an earlier bar | A matched bar must precede the branch's shared release if the main bar preceded that release. The duplicate-bar regression fails on `[A, B, C, B]` versus `[C, B, stop]` with the first bar's step still in the branch script. |
| Registration hard stop misses short raw content | The registration check recognizes every nonempty repetition in email text, including retained UTF-8 bytes. Exact approval still stops at `data-terms / not-authorised` for raw values of one, two, and three characters. The tests verify an empty mailbox and a final stop for both text and UTF-8 byte arrays. |
| Ledger retention stays disabled after prefix recovery | Reopening exposes the saved prefix for audits and exports. On the next write, the file ledger verifies that prefix against the state-store head, discards the uncommitted suffix newest first, and resumes writing at the saved head. Mandate reload records are deferred until writes resume. Pruning again checkpoints and saves the new head before deleting archives. The new tests verify continued writes, retention, export after reopening, and rejection of a tampered saved prefix. The existing interrupted-save regression still checks the prior prefix on two reopens. |
| Continuation accepts copies and citations | The comparer tracks a refused statement by ID, claim digest, and wire digest. It inspects stores and complete packets before the display projection, including derived citations, renamed copies, encoded evidence, and private joint fields. Tests cover ID and digest references, a packet with a renamed copy, and a store whose display projection omits the copied value. The live invoice regression verifies that the supplier's independently signed invoice can be admitted and that the refused account is never sent by the business agent. |
| Continuation misses approved email and other effect parameters | The comparison sees the authorized intent parameters and the parameters passed to the effect adapter. It rejects an effect release with missing comparison data after an identified standalone refusal. The email regression reaches exact approval and an effect release with no message packet, and verifies that repeating the refused value is flagged while independent text can proceed. |
| Proof and joint paths skip refusal checks | Witnessed inbound refusals go through the continuation check on proof and joint paths. The email regression exercises both registered method classes in the in-memory runner, and a separate regression checks the original joint payload when the trace redacts the relevant fields. |

The tests for short raw content, resumed retention, duplicate bars, copied facts, digest citations, and email leakage were also run against the source at `081cbc9ee` in a scratch checkout. They reproduced the failures.

The earlier G2 copied-DID, A2 explicit-`go`, and W standalone-supersession fixes remain covered by `branch-comparison.test.ts`. The approval-reuse regression checks that Sam's agent makes the second approval request and has no later send or release.

## The ten package test failures

| Tests | Classification and resolution |
| --- | --- |
| `agreement-credential-alternative.test.ts` (2) | The fixture used a commitments patch to add a test-only stop. The stop now belongs to the shared fixture, so C3 compares the same execution boundary and the regressions reach the private-field check and the provider's independent credential check. |
| `configuration-matrix.test.ts` (2) | The fixtures shortened the script in a transport patch and put a signed step-down fault on the configuration main path. Both now trim the shared script. The signed step-down is a branch under email transport. The tests assert the original configuration refusals and C3 remains enforced. The larger matrix test uses an independent test per configuration after the aggregate test hit its timeout. Each cell keeps its branch, trace, and layer assertions. |
| `complete-model.test.ts` (1) | The capacity list expected an invocation that the ruled salary branch no longer produces. Its first employer stops at `data-terms / prohibited`. The capacity test still requires 26 attachment round trips and now uses a measured 162,455-byte A2A invocation in place of the obsolete invocation. The live salary test checks the former follow-on invocation is absent. The corpus spy also forwards all arguments so full coverage exercises the actual proof-evidence and withdrawal checks. |
| `anonymous-alternative.test.ts` (1) | Stale classification. The index refuses the unnamed request at `authority / not-authorised`. The test requires the refusal and its failed check. |
| `solid-by-reference.test.ts` (1) | Stale classification. The permitted withdrawal is setup, and the subsequent read is refused at `source / not-authorised`. The test still checks the source's refusal and the retained copy. |
| `solid-reference-status.test.ts` (1) | Stale manifest classification. The test now requires `runs` and a trace for all five Solid access paths. |
| `content-parts.test.ts` (1) | Stale display-text selector. The test locates the practice agent's structured-form request by its decision fields and checks its hospital reference, provenance, and follow-up. |
| `selective.test.ts` (1) | Stale blocked classification. The employer admits the verified hidden-date predicate as `attested`, with rule, issuer, and freshness bindings. The test checks the answer and the absence of the private date in the returned packet. |

## Manifest and specification

The replay measured **283 paths, 278 runs, zero disagreements, and five blocked**. It executed all 278 paths with traces using the local sparq adapters. The comparison covered every manifest field affected by the comparator and verified the six saved joint-trace hashes. After refining the matcher for independently sourced stores, I reran all 15 configurations with standalone inbound refusals in their recorded traces.

The only changed row is `mortgage-main/a2a-task-state-lies` under `transport-a2a`. It moved from `disagrees` to `runs` with `admit / intact / integrity` and no note. Its `notReached` lists main event 131 from the bank and event 153 from Sam's agent. The replay reproduced the 122-event trace byte for byte with its recorded commit metadata.

The initial matcher flagged `pay-an-invoice/branch-1` because the authorized invoice and the refused email statement share a supplier and account. The trace shows the independently gated invoice admission and the later P4 stop before any payment order. The refined matcher still checks complete claim copies and references during that admission. The rerun confirmed `runs` with `refuse / source-not-authoritative / source`.

The mounted specification file `specs/60-evaluation.md` is read-only in this worktree. Ruling 34d supplies this sentence for its editorial update.

> A bar of the main path counts as missing only when the branch still contains the step that raises it. Bars of steps the branch leaves out are listed as not reached.

## Verification

- All focused Vitest invocations used Node 24 and `--maxWorkers=2`. The final branch, email, labels, and oracle run passed 98 tests. The transport, salary, and approval-reuse regressions also passed.
- The six other affected files covering agreement credentials, anonymous identity, Solid reference access and status, content parts, and selective disclosure passed 37 tests.
- `configuration-matrix.test.ts` passed all 43 tests, including the 37 individual mortgage configuration cells and both signed configuration refusals.
- `complete-model.test.ts` passed in its standard sampling mode. It exercised 87 live paths, 369 messages, 83 intents, and 36 agreements, with complete recorded kind and configuration coverage and all 26 pinned attachment checks.
- Both oracle files passed with `ANSWERABLE_REQUIRE_LIVE_AGGREGATE=1`. The 163-path snapshot retains SHA-256 `4f63d12f5e58b1d4a2f085c3d524b671663a1d96dd61c45ee875838d1308922f`.
- Package typecheck, Biome lint, schema export check, workspace RDF discipline, and the agent-layer guard passed. The package RDF pipeline reported **0 failures and 212 allowances**.
