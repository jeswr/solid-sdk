<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 40 report

## Phase 1

Phase 1 is implemented. The reference-package checks and sampled corpus passed.
The six SPARQ stand-in policy-config tests need an environment that permits
the child process. The three pilot integration runs are assigned to the
orchestrator under Addendum A6.

Baseline `162ce4edf` on `claude/project-thread-ee3kq8-p92`. Addendum A governs
the evidence format, range redaction, store view, pilot readers and trace
comparison. Node 24.22.3 and pnpm 10.4.1.

### Changes

| File and line | Change |
| --- | --- |
| [answerable-stores.ttl:1](vocab/answerable-stores.ttl#L1), [answerable-stores.shacl.ttl:1](vocab/answerable-stores.shacl.ttl#L1) | Publish the record vocabulary and separate durable shapes. The original message ontology and shape file retain their bytes. |
| [store-v1.jsonld:1](vocab/context/store-v1.jsonld#L1), [store-contexts.ts:11](src/wire/store-contexts.ts#L11) | Add the SHA-256-pinned JSON-LD 1.1 display context and offline loader. The message loader still refuses this IRI. |
| [store-quads.ts:8](src/wire/store-quads.ts#L8), [store-document.ts:23](src/wire/store-document.ts#L23) | Write bytewise-sorted N-Quads, parse synchronously via `parseRdfSync`, and project reachable subjects across graphs to a common default graph for Turtle and JSON-LD. |
| [record.ts:35](src/model/store/record.ts#L35), [record.ts:515](src/model/store/record.ts#L515) | Encode and strictly decode one named graph per sealed entry. Store the native type on disclosed rows, preserve ordered values and original timestamp spelling, and bind compact approval bytes to their byte digest. Withheld rows project only the supplied chain data. |
| [named-values.ts:171](src/model/named-values.ts#L171) | Thread optional limits through the existing named-values encoder. Store limits allow 32 levels, 50,000 JSON values, strings of up to 1,048,576 UTF-16 code units, and arrays of up to 8,192 members. The N-Quads read/write byte budget is 16 MiB. |
| [ledger.ts:152](src/store/ledger.ts#L152), [ledger.ts:255](src/store/ledger.ts#L255), [ledger.ts:314](src/store/ledger.ts#L314) | Detect each segment's format from its first nonblank character. Append one N-Quads block ending with its hash quad and fsync it. Read JSONL unchanged and keep writing to a JSONL current segment until rotation. Preserve the original bytes of the retained prefix during recovery and refuse recovery when the saved prefix and tail are interleaved. Export `readLedgerSegment` and the rollout option. |
| [federation-codegen.mjs:15](scripts/federation-codegen.mjs#L15), [codegen.config.json:9](codegen.config.json#L9) | Compile the full store and message profiles separately for admission reporting, and generate the selected flat entities with the combined input lock. |
| [codegen-manifest.json:1](src/generated/codegen-manifest.json#L1), [codegen.lock.json:1](src/generated/codegen.lock.json#L1), [full-admission.json:1454](src/generated/full-admission.json#L1454) | Regenerate input/output hashes and append the store admission findings. The 242 previously recorded message admission findings remain an exact prefix. |
| [model.d.ts:103](src/generated/model.d.ts#L103), [model.js:285](src/generated/model.js#L285), [model.json:279](src/generated/model.json#L279), [shapes.ttl:22](src/generated/shapes.ttl#L22) | Regenerate types, runtime model, manifest and shapes for the two entry classes. |
| [check-rdf-pipeline.mjs:21](scripts/check-rdf-pipeline.mjs#L21), [check-rdf-pipeline.mjs:237](scripts/check-rdf-pipeline.mjs#L237) | Add `store-json-write`, including exact counts for lock, legacy state, and legacy JSONL writes. The rule tracks direct and locally assigned JSON serialization into file writes. Store JSON parsing has exact reader scopes for the lock, state and legacy ledger. |
| [check-no-trace-change.mjs:26](scripts/check-no-trace-change.mjs#L26) | Run Addendum A1's two scenarios in a disposable package copy, check the output counts, compare all artifacts, and remove the copy. Child output uses a file descriptor so it is available in this sandbox. |
| [package.json:28](package.json#L28), [README.md:300](README.md#L300) | Publish explicit store vocabulary subpaths. The existing `files` inventory already includes all of `vocab/`. Document mixed formats and the JSONL rollout option. |
| [pilot-integration.mjs:746](../personal-agent/scripts/pilot-integration.mjs#L746), [pilot-a2a-integration.mjs:845](../personal-agent/scripts/pilot-a2a-integration.mjs#L845), [pilot-regional-integration.mjs:825](../personal-agent/scripts/pilot-regional-integration.mjs#L825), [pilot-regional-integration.mjs:1248](../personal-agent/scripts/pilot-regional-integration.mjs#L1248), [pilot-regional-integration.mjs:1300](../personal-agent/scripts/pilot-regional-integration.mjs#L1300) | Move the three pilot scripts' direct readers to `readLedgerSegment`. The regional clinical-payload absence check searches the decoded rows and the raw file. |
| [mortgage-durable.test.ts:332](../personal-agent/src/pilot/mortgage-durable.test.ts#L332), [policy-config.test.ts:359](../personal-agent/src/pilot/policy-config.test.ts#L359) | Move the two test readers to `readLedgerSegment` and retain the assertions. A second search for `ledger.jsonl`, `-ledger.jsonl` and `record.jsonl` found no additional direct readers requiring conversion. |

### Failing-first tests

The initial focused run in `/tmp/p92-red.log` failed all seven target files.
The ledger format and guard suites reached their new assertions against the old
implementation. The new codec, vocabulary and corpus files and the email file
failed to load their planned modules. The extra byte-boundary tests were then
run against the first implementation and failed on the unpaired surrogate and
missing terminator. The interleaved recovery regression also failed before its
prefix check was added. The guard fixture for reassignment and an unlisted
store reader failed before that flow and the exact reader scopes were added.

| File and line | Coverage |
| --- | --- |
| [store-vocabulary.test.ts:18](test/store-vocabulary.test.ts#L18) | Ontology labels and comments, domains and ranges, shape paths, context terms and SHA pin. The store context is refused on message admission. |
| [store-quads.test.ts:6](test/store-quads.test.ts#L6) | Deterministic byte ordering, quad-set round trip, blank-node refusal and failure on literals that cannot be serialized losslessly as UTF-8. |
| [record-rdf.test.ts:125](test/record-rdf.test.ts#L125) | Thirteen required typed discriminators and an untyped extension, L1–L4, SHACL validation, committed and legacy approval redactions, one-quad hash mismatch, and equal default-graph Turtle and JSON-LD projections. Verification uses the existing public ledger verifier, which calls the private `validSeal`. |
| [record-corpus.test.ts:20](test/record-corpus.test.ts#L20), [model-corpus.ts:181](test/helpers/model-corpus.ts#L181) | Observe each agent ledger after its run. Check every captured entry before and after N-Quads, preserve field order, re-verify the original head, and check the untyped type ratchet. `FULL_CORPUS=1` keeps the sampler's exhaustive mode. |
| [ledger-file-format.test.ts:22](test/ledger-file-format.test.ts#L22), [ledger-v1/README.md:1](test/fixtures/legacy/ledger-v1/README.md#L1) | New, legacy and mixed ledgers, old checkpoint, rotation, trusted head, prefix preservation, malformed blocks and truncation. Both JSONL fixture files come from the baseline compiled writer. Each fixture carries authored source records and the adjacent README describes their generation. |
| [rdf-pipeline.test.ts:188](test/rdf-pipeline.test.ts#L188) | Prove that direct JSON writes and JSON bytes assigned to a local before a write both trigger `store-json-write`. |
| [email.test.ts:1026](test/email.test.ts#L1026), [email.test.ts:1191](test/email.test.ts#L1191), [ledger-tamper.ts:10](test/helpers/ledger-tamper.ts#L10) | Mutate the original bytes in both corruption tests, verify that the edited line or block still decodes, and keep the same trusted-head, invalid-prefix and failed-audit assertions. The failed-head/audit test has a legacy twin. |

### Generation and vocabulary

`RecordEntry` and `WithheldRecordEntry` are generated. The latter has its own
shape and forbids `recordType` and `record`. The generated dateTime mapping
projects to JS `Date`; the store wrapper validates the RDF literal and keeps
its original lexical string for the JCS seal. The generated message
`GrantRecord` remains available to existing callers.

The store profiles below are hand-held registered `ModelSpec`s. Generated
multi-valued fields have set semantics and the store representation preserves
sequence and duplicate values. The admission errors are recorded in
[full-admission.json:1454](src/generated/full-admission.json#L1454). In the
table, “unprojected node” is `sh:node: inline or unprojected sh:node reference`
and `sh:node: sh:node requires a projected composite link`. For each row, the
right-hand column is bead text for `surface:packages/federation-codegen`.

| Store class | Admission error | Bead to file |
| --- | --- | --- |
| `GateCheckRecord` | Unprojected `recordFieldOrder` | Generate an optional ordered field-key list and preserve the native check object's field order. |
| `GateDecisionRecord` | Unprojected `recordChecks` and `recordFieldOrder` | Generate ordered check-digest and field-key lists. Preserve duplicate members through N-Quads. |
| `VerificationResult` | Unprojected `recordLimitations` and `recordFieldOrder` | Generate ordered verification limitations and preserve explicitly empty lists. |
| `RepresentationAssessment` | Unprojected `recordFieldOrder` | Generate an optional ordered field-key list for assessment projections. |
| `AuthorisationDecision` | Unprojected `action`, `policy`, `recordOriginalDigests`, and `recordFieldOrder`, and unsupported `sh:xone` | Generate named-value projections for action and policy, with an exclusive named reason or textual explanation. |
| `GrantRecord` | Unprojected `recordFieldOrder` in the store shape | Support optional native field order in the durable grant projection while supporting the existing flat shape separately. |
| `MessageRecord` | Unprojected `recordApprovalBinding` and `recordFieldOrder`, unsupported `sh:or` on `recordConditions` | Generate open approval bindings and conditions with a literal-or-IRI union. Keep the record message identifier and digest. |
| `ItemTransferRecord` | Unprojected `transferRecipient` and `recordFieldOrder`, unsupported `sh:or` on `transferDuties` | Generate structured recipients and ordered duties with the open-value union. |
| `ApprovalRecord` | Unprojected `recordFieldOrder` | Generate optional ordered field keys for approvals and retain the exact JWS string and its digest. |
| `RecordCheckpoint` | Unprojected `prunedSegments` and `recordFieldOrder` | Generate ordered segment filenames in checkpoints. Preserve filename order and scalar chain fields. |
| `UntypedRecord` | Unprojected `recordValues` and unsupported literal-or-IRI `sh:or` on `schema:value` | Generate named-value collections with order, null, arrays, objects, typed scalars, and IRI values. |

New terms are defined in [answerable-stores.ttl:14](vocab/answerable-stores.ttl#L14).
Notation below uses the Answerable namespace for unprefixed names.

- Classes … `RecordEntry`, `WithheldRecordEntry`, `GateCheckRecord`,
  `GateDecisionRecord`, `MessageRecord`, `ItemTransferRecord`,
  `ApprovalRecord`, `RecordCheckpoint`, `UntypedRecord`.
- Entry properties … `sequence`, `previousEntryHash`, `previousEntry`,
  `entryHash`, `recordDigest`, `recordType`, `record`.
- Payload properties … `recordFieldOrder`, `recordValues`, `recordIdentifier`,
  `recordAgent`, `recordGate`, `recordChecks`, `recordLimitations`,
  `recordExplanation`, `messageKind`, `recordBinding`,
  `recordApprovalBinding`, `recordConditions`, `transferItem`,
  `transferRecipient`, `transferAgreement`, `transferDuties`,
  `transferMessage`, `approvalDecision`, `approvalProofDigest`,
  `approvalJws`, `approvalJwsDigest`, `recordStandIn`, `prunedSegments`,
  `lastPrunedSeq`, `lastPrunedHash`, `checkpointNote`, `recordOriginalDigests`,
  and `transferSubjectText`.
- Individuals … `reason/{approval-given,authority-valid,established-earlier,evidence-complete,fit-for-use,intact,minimal-disclosure,no-action,no-claims,no-data,no-personal-data,no-principal,recipient-established,source-accepted,terms-acceptable,terms-allow,within-limits,within-mandate}`,
  `verification-outcome/{valid,invalid,unsupported,unknown-key,not-applicable}`,
  `assessment-outcome/{accepted,not-accepted,unresolved}`,
  `authorisation-outcome/{permit,deny,approval-required,indeterminate,ask-more}`,
  `approval-decision/{approve,deny,decline}`, and
  `representation-status/{anonymous,unknown}`.

Reused terms are as follows.

- Answerable … `VerificationResult`, `RepresentationAssessment`,
  `AuthorisationDecision`, `GrantRecord`, `NamedValueCollection`,
  `NullValue`, `at`, `reason`, `check`, `verdict`, `outcome`,
  `protectedObject`, `property`, `mechanism`, `verificationMaterial`,
  `verifier`, `deciderRole`, `evaluator`, `actor`, `party`, `operation`,
  `statement`, `decider`, `actionDigest`, `policy`, `basis`, `approval`,
  `matchedRule`, `kind`, `grantor`, `grantee`, `digest`, `conversation`,
  `subject`, and the existing `reason/`, `check/`, `verdict/`,
  `gate-outcome/`, and `grant-kind/` individuals.
- PROV-O … `generatedAtTime`, `wasAttributedTo`, `actedOnBehalfOf`,
  `wasDerivedFrom`. ODRL 2.2 … `action`. VC 2.0 … `issuer`, `validUntil`.
- Schema.org … `ItemList`, `PropertyValue`, `itemListElement`, `position`,
  `name`, `propertyID`, and `value`. RDF and XSD provide type and
  literal datatype terms.

### Ratchet and design details

The sampled untyped ratchet lists 71 native record types. [record-untyped-baseline.json:3](test/fixtures/record-untyped-baseline.json#L3)

```text
access-decision, access-grant-intended, access-granted, activity, agreement
agreement-transition, approval-consumed, assessment-receipt, certified-index-quality
challenge, challenged-by-peer, check-verdict, closed-by-peer, closed-locally
code-mapping-derivation, configuration-selection, content-appraisal, data-stored
derivation-evidence, duty-acknowledged, duty-created, duty-discharged, email-content
employment-status-interpretation, escrow-hold-statement, federation-chain-check
forum-decision, forum-record-requested, implementation-statement, income-corroboration
index-history-check, joint-derivation, joint-message, joint-message-evidence
mapping-original, message-held, message-release-intended, message-release-sealed
organisation-approval, origin-fetch, original-reference-read, outcome
payment-agreement-proofs-verified, payment-receipt-recorded, payment-reserved
peer-outcome-report, pod-store, public-access-served, query-answer, query-counted
query-release-check, reading, record-anchor-receipt, record-audit, reference-copy-stored
reference-read, refusal, reputation-checked, resource-read, resource-read-result
rule-evaluation, service-check, service-decision, settlement-message-admitted
source-authority, statement-superseded, structured-form-request, trust-pinned
trust-requested, unstructured-content, usage-model-opinion
```

The final sampled corpus passed. The diagnostic capture counted 40,840 entries
from 469 ledgers over 87 paths. The earlier runs exposed successful gate
reasons and audit fields absent from the first store specs. The passing run
required all sampled entries of the thirteen designated types to be typed and
checked the exact ratchet set. The separate unit fixtures exercise all thirteen
types, including checkpoints generated by the file ledger. The exhaustive
`FULL_CORPUS=1` option was not run in this lane.

Successful gate reasons and several record-specific outcomes have no named
individuals in the message ontology. The store vocabulary defines those
individuals, represents the native anonymous/unknown assessment markers
explicitly, and keeps free-form authorisation explanations in a text field.
The corpus showed that the audit sink adds \`originalDigests\` to authorisation
decisions, and that transferred claims can carry a text subject. The store
specs preserve those fields as an ordered digest list and a literal fallback
for the native subject.
These changes affect display and durable data only. The flat generated header
uses the existing type projections around the dateTime lexical preservation.
The closed decoder compares the selected entry graph with its lossless
re-encoding, so unexpected predicates, extra payloads, invalid links, and
malformed positions cannot disappear on decode. The verifier still checks the
seal.

Addendum A2 specifies one byte edit site. The same file also rewrote the saved
prefix in a second test. That mutation now uses the same helper and keeps the
original invalid-prefix refusal and unchanged-file assertion. No other
existing reference test assertions changed. The three integration scripts were
syntax-checked only and remain for the orchestrator to run.

### Verification and commands

All Vitest commands used `--maxWorkers=2`. The worktree manifest totals
are 283 paths, 278 runs, 0 disagreements, and 5 blocked. Its SHA-256 is
`7b490268f90bd3c0541322fc27e4902531383aa1abdcf0b54ca50a63f2e78f53`.
The oracle snapshot SHA-256 is
`4f63d12f5e58b1d4a2f085c3d524b671663a1d96dd61c45ee875838d1308922f`.

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/agent-reference exec tsc -p tsconfig.build.json` followed by `node scripts/copy-generated.mjs` in the package | Compile-only. The package build and Turbo gate were not run. |
| `pnpm --filter @jeswr/agent-reference run codegen` and `pnpm run check:codegen` | Both entry entities generated. Workspace guard passed for eight generated projects. |
| `pnpm --filter @jeswr/agent-reference run typecheck`, `run lint`, `run check:rdf-pipeline` | Typecheck and lint passed. Lint reported 647 warnings and 596 informational diagnostics. The RDF guard reported zero failures and 216 allowances, including four named writes covered by the new rule. |
| Focused `store-vocabulary`, `store-quads`, `record-rdf`, `ledger-file-format`, `rdf-pipeline` and `codegen` tests | 29 passed across five files, plus two focused RDF guard tests. |
| Focused `email`, `forum`, `durable-capabilities` and `pod-mirror` tests | 60 passed across four files. |
| `pnpm --filter @jeswr/agent-reference exec vitest run test/record-corpus.test.ts --maxWorkers=2` | Passed in 806.21 s. Earlier diagnostics failed on required untyped payloads and provided the sampled ratchet inventory. |
| `pnpm --filter @jeswr/agent-reference exec vitest run test/oracle.test.ts test/oracle-snapshot.test.ts --maxWorkers=2` | Three passed in 239.06 s. The snapshot and the assertions are unchanged. |
| `node scripts/check-no-trace-change.mjs` in the engine package | Passed. The selected scenarios ran two and three paths respectively. Both reported 278 runs, 0 disagreements and 5 blocked. The five selected traces were equal after removing `generated.commit`. The remaining trace and outline bytes, manifest rows and index rows matched. |
| `pnpm --filter @jeswr/personal-agent exec vitest run src/pilot/mortgage-durable.test.ts src/pilot/policy-config.test.ts --maxWorkers=2` | Mortgage-durable passed all three. Policy-config passed three and was blocked in six by the sandbox's `spawnSync … EPERM` on the executable stand-in. An independent spawn probe reproduced the failure with Node 24 and piped output. No harness or evaluator was changed to bypass it. |
| `node --check` on the three edited integration scripts | Passed. Orchestrator still runs `pilot-integration.mjs`, `pilot-a2a-integration.mjs` and `pilot-regional-integration.mjs`. |
| `git diff --check`; protected-path diffs and SHA-256 | No whitespace errors or changes to wire pins, oracle, trace/outline files or the run manifest. A source comparison also matched the complete interface, sealing, memory ledger and verifier bodies against the baseline. |

### Speed

The baseline in Addendum A7 was recorded with
`node scripts/profile-journey.mjs --iterations=3 --main-only`. Its JWS
times were 8,216 / 7,336 / 7,399 ms (median 7,399 ms). Its Data Integrity
times were 8,065 / 8,015 / 7,944 ms (median 8,015 ms).

The isolated repeat passed the 3% median threshold for both configurations.

| Configuration | Before median | After iterations (ms) | After median | Change |
| --- | ---: | --- | ---: | ---: |
| JWS | 7,399 ms | 8,222 / 7,500 / 7,499 | 7,500 ms | +1.37% |
| Data Integrity | 8,015 ms | 7,893 / 8,162 / 8,335 | 8,162 ms | +1.83% |

Two concurrent runs had test workers active and yielded JWS/Data Integrity
medians of 9,762/9,123 ms and 12,595/13,980 ms. The first isolated run yielded
7,561/8,326 ms, putting Data Integrity 3.88% above its reference. The immediate
isolated repeat used the same code and put both configurations within the
threshold. `MemoryLedger.append` and its scenario callers retain their original
source.

### Other beads to file

| Label | Bead text |
| --- | --- |
| `surface:packages/agent-reference` | Evaluate RDF-backed runtime indexes, gate queries, SPARQL and pod-backed stores. Set a throughput budget and require oracle parity for any in-memory index change. |
| `needs:jesse` | Decide on RDFC-1.0 entry seals and in-place evidence conversion separately. Define independent formats, chain continuity, retention governance, and migration audit requirements. |
| `surface:packages/agent-reference` | Extend typed coverage beyond the record and snapshot ratchets. Survey the purpose-bound store payload, proof cache, mailbox stores and stand-in pods. Require corpus round trips and explicit migration rules. |
| `needs:jesse` | Decide whether fixture JSON-LD should link slug references, model open maps as nodes, support framing back to authoring form, or use different file extensions. Decide separately whether outlines, run manifests, exported schemas or settlement views need a different representation. |
| `surface:apps/agent-explorer` | Review the phone view, tours, home page and walkthrough video after the linked-data inspector ships. |

### Follow-up (40c)

- The queued industrial disclosure test reads the enforcement ledger with `readLedgerSegment`
  and requires one record with both `type: "access-recheck"` and `decision: "deny"`. The live
  and restart withholding assertions precede the log check. The test search found
  that mortgage-durable and policy-config already use the segment reader. The all-file scans
  in energy-durable and A2A still inspect on-disk bytes for leaked data and make no assumption
  about the ledger format. [protected-disclosure.test.ts:481](../personal-agent/src/pilot/protected-disclosure.test.ts#L481)
- C.2 is independent of Phase 1. It reads `policyModule.verdicts` from the `demo --only E`
  JSON report and treats any key as `E: true`. `runDemo` installs the tallying evaluator, which
  counts every returned effect in memory. The energy runtimes use `MemoryLedger`. The anonymous
  outbound gate checks the mandate's autonomous and with-approval policies for explicit
  prohibitions. That code predates Phase 1 and the orchestrator's energy report shows 14
  `not-applicable` results from `@jeswr/solid-odrl`. E.3 counts service-side
  `authorisation-decision` records and can pass with those evaluator results. The Phase 1
  `readLedgerSegment` call in the integration script feeds P.3.
  [pilot-integration.mjs:685](../personal-agent/scripts/pilot-integration.mjs#L685)
  [pilot-integration.mjs:714](../personal-agent/scripts/pilot-integration.mjs#L714)
  [pilot-integration.mjs:746](../personal-agent/scripts/pilot-integration.mjs#L746)
  [demo/run.ts:156](../personal-agent/src/pilot/demo/run.ts#L156)
  [policy-config.ts:359](../personal-agent/src/pilot/policy-config.ts#L359)
  [scenarios/common.ts:233](src/scenarios/common.ts#L233)
  [gates/outbound.ts:2759](src/gates/outbound.ts#L2759)
  [scenarios/energy.ts:123](../personal-agent/src/pilot/scenarios/energy.ts#L123)

Node 24 verification used `pnpm --filter @jeswr/personal-agent exec vitest run` with
`--maxWorkers=2`. The pre-edit filtered expiry test and the post-edit full
`src/pilot/protected-disclosure.test.ts` run were blocked during setup. Both industrial cases
hit `spawnSync … EPERM` on the SPARQ stand-in. Both health cases failed to get a free port,
and a direct loopback bind probe returned `EPERM`. The focused `energy.test.ts` and
`purpose-store.test.ts` suites passed all 11 tests. An offline `PurposeBoundStore` fixture
decoded its N-Quads segment and confirmed rechecks of `permit`, `deny` after grant expiry,
and `deny` after reopening. The one-file Biome check and `git diff --check` passed.

## Review fixes (40d)

| Finding | Fix and regression coverage |
| --- | --- |
| Non-entry JSONL lines in the recovered prefix | Restored the `162ce4edf` filter `entry.seq <= head.seq` before verifying the saved head. Format detection also recognises JSONL when a scalar precedes the first entry. Both positions for a `false` line failed in the pre-fix run. [Format detection](src/store/ledger.ts#L183) · [Recovery](src/store/ledger.ts#L261) · [Regression](test/ledger-file-format.test.ts#L80) |
| Record type altered by the generated setter | Chose the exact untyped RDF round trip. The header writes the native type as an RDF string literal, so its value agrees with the untyped payload and the original seal. The NUL fixture failed on RDF reopen before the fix and passed in the legacy format. [Header](src/model/store/record.ts#L463) · [Regression](test/ledger-file-format.test.ts#L113) |
| Missing final JSONL newline | Restored the baseline durable rewrite of the last retained JSONL segment, including a newline after every retained entry. The assertion on restored bytes failed before the fix. The test then appends, reopens the segment and verifies the chain. The RDF guard allows exactly one JSON write in the recovery writer. [Recovery writer](src/store/ledger.ts#L170) · [Guard](scripts/check-rdf-pipeline.mjs#L28) · [Regression](test/ledger-file-format.test.ts#L97) |
| Invalid typed payload timestamp | Validate the payload's `xsd:dateTime` lexical form during typed projection. The invalid timestamp selected `ApprovalRecord` in the pre-fix run. The regression checks that `UntypedRecord` conforms to the published shape and decodes to the exact original entry. [Timestamp validation](src/model/store/record.ts#L346) · [Regression](test/record-rdf.test.ts#L144) |

The recovery tests also exercise the baseline JSONL behaviour with interleaved
uncommitted rows and extra whitespace, and confirm that N-Quads recovery requires
a contiguous byte prefix. The sealing and verification functions match `162ce4edf`.
The failing-first run recorded five failures across the four review findings in
`/tmp/p92-40d-red.log`.

### Verification

Node 24.22.3 and pnpm 10.4.1. Every Vitest run used `--maxWorkers=2`.

| Check | Result |
| --- | --- |
| `tsc -p tsconfig.build.json` and `node scripts/copy-generated.mjs` in agent-reference | Compile-only passed. |
| Focused store-vocabulary, store-quads, record-rdf, ledger-file-format, rdf-pipeline, codegen, email, forum, durable-capabilities and pod-mirror tests | All 98 passed, including byte-for-byte codegen drift. |
| `test/oracle.test.ts` and `test/oracle-snapshot.test.ts` | All three passed. The live aggregate adapter was used, and all 163 oracle paths matched. |
| `test/record-corpus.test.ts` | Passed. The sample verified 40,840 entries from 469 ledgers across 87 paths and matched the untyped ratchet. |
| `pnpm run check:codegen` and `pnpm --filter @jeswr/agent-reference run check:rdf-pipeline` | Eight generated projects passed. The RDF guard reported zero failures and 217 explicit allowances. |
| `node scripts/check-no-trace-change.mjs` | The first copy ran out of disk space. The unmodified command passed on retry after space became available. Both scenarios reproduced their five selected traces, and the outputs retained 278 runs, zero disagreements and five blocked paths. |
| `pnpm --filter @jeswr/agent-reference --filter @jeswr/personal-agent run typecheck` and `run lint` | Both packages passed. Agent-reference lint reported 647 warnings and 597 informational diagnostics. |
| `src/pilot/mortgage-durable.test.ts` and `src/pilot/policy-config.test.ts` in personal-agent | Mortgage-durable passed all three tests. Policy-config passed three and could not run six because the sandbox refused to spawn the executable SPARQ stand-in (`EPERM`), as in 40b. |
| `git diff --check` and protected-path comparison with `162ce4edf` | Passed. The oracle snapshot, trace and outline files, run manifest, and message context pins retain their bytes. |

The combined reference run passed all 102 tests across 13 files in 756 seconds.

## Review fixes (40e)

- JSONL reads reject non-object rows and invalid record payloads with the existing
  stored-record error. Recovery rejects those segments before rewriting them, so
  the 40d fixture now checks refusal and byte preservation. Full-chain and range
  verification both reject missing rows, and full-chain verification checks the
  payload seal of every entry in a successful chain.
  [JSONL reader](src/store/ledger.ts#L170) · [Full-chain verifier](src/store/ledger.ts#L428) · [Range verifier](src/store/ledger.ts#L487) · [Regressions](test/ledger-file-format.test.ts#L87)
- Recovery refuses uncommitted rows in any archive that precedes the last retained
  segment. The all-JSONL regression checks the ordering error, the preserved head,
  and the bytes of the archive and active segment.
  [Recovery](src/store/ledger.ts#L272) · [Regression](test/ledger-file-format.test.ts#L199)

The pre-fix file-format run failed all ten new or updated cases. All 20
file-format tests passed after the fix. The library-only build passed with Node
24.22.3 using `npx tsc -p tsconfig.build.json && node scripts/copy-generated.mjs`.
The requested Vitest run passed all 50 tests across four files, including the
record corpus, in 681 seconds with `--maxWorkers=2`. Biome passed with one
existing warning and seven existing informational diagnostics. `git diff --check`
passed, and the trace, outline, and run-manifest diff was empty.

## Review fixes (40f)

- Ledger hashing and sealing reject non-finite numbers before JSON serialization
  can collapse them to `null`. The JSONL reader rejects them during parsing. The
  regressions cover an overflowing number substituted for a sealed `null`, both
  seal modes, and file and memory appends with non-finite values.
  [Ledger](src/store/ledger.ts) · [Regressions](test/ledger-file-format.test.ts)
- JSONL parsing rejects rows with a missing or invalid sequence or hash before
  recovery filters the retained prefix. The recovery regression compares the
  active and archived bytes after refusal. The reader rejects blank and
  whitespace-only rows while allowing a single final newline.
  [Reader](src/store/ledger.ts) · [Regressions](test/ledger-file-format.test.ts)
- Legacy credential replay verifies the retained chain and checks it against the
  trusted head when available or required. An invalid seal leaves the credential
  unavailable. The restart regression changes an inbound refusal to an admission
  without updating its seal.
  [Replay](src/runtime/agent.ts) · [Regression](test/runtime-graph-ingress.test.ts)

All ten regression cases failed before the fix and passed afterward on Node
24.22.3. The library-only build passed with
`npx tsc -p tsconfig.build.json && node scripts/copy-generated.mjs`.
The requested Vitest run with `--maxWorkers=2` passed all 100 tests across six
files in 694 seconds, including the sampled corpus and credential replay. Biome
passed on the changed TypeScript files with 27 existing warnings and 12 existing
informational diagnostics. The package typecheck, RDF pipeline check, and
`git diff --check` passed.

The Addendum A check ran `mortgage-core` and `pay-an-invoice` in a temporary copy.
Both runs reported 278 runs, zero disagreements, and five blocked paths. The five
selected traces matched apart from `generated.commit`. The other traces and
outlines matched byte-for-byte, and the manifest and index rows matched. The
script removed its temporary copy, and the worktree output files retained their
original bytes.

## Performance (40g)

The Node 24.22.3 CPU profile of the issuance-authority test took 26.65 s. It
attributed 11.83 s to segment reads, split almost evenly between the
`FileLedger` constructor and `entries()`. Of that, 8.38 s was in
`recordEntryFrom`, including 4.30 s rebuilding the canonical graph, and 2.96 s
was in `readNQuads`. The profile attributed about 0.13 s to N-Quads
serialization on append.

The reader now rereads the file bytes and compares them to a cached decoded
prefix. A byte-identical prefix ending at a complete block can be reused across
ledger instances. New blocks and changed bytes go through the original RDF
parser and canonical graph check. The shared cache is capped at 16 MiB of file
bytes and returns independent copies to callers. Recovery and pruning discard
removed cache entries. Durable runtime startup verifies the retained chain when
accepting a saved head, and audit reads still recompute seals. Appends still
seal and fsync each entry. [Ledger reader](src/store/ledger.ts) ·
[Runtime open](src/runtime/agent.ts)

The ledger regressions cover cache reuse across opens and appends, same-size
tampering, caller mutation of nested values, truncation, and recovery of a
prefix containing multibyte text. The audit regression checks that a runtime
reopened on a corrupted chain refuses to append even if the head hash field
still matches. [Ledger regressions](test/ledger-file-format.test.ts) ·
[Audit regression](test/email.test.ts)

The before and after pilot runs used one Vitest worker on Node 24.22.3. Times
are for the individual test bodies.

| Pilot test | Before | After |
| --- | ---: | ---: |
| Health-durable issuance authority | 27.98 s | 15.56 s |
| CLI negotiation through Gmail payload files | 7.11 s | 5.21 s |
| A2A simultaneous send | Setup failed at 55 ms | Setup failed at 34 ms |

Issuance was 44% faster and 5.8% above the supplied 14.7 s main baseline.
The A2A attempts both stopped before the timed dispatch. An independent
loopback bind returned `EPERM`, so the 2,500 ms assertion remains unverified
here.

The library-only compile and package typecheck passed. The six focused
reference files passed all 103 tests, including the ledger format, record RDF,
durable capabilities, store quads, email audit and credential replay. Biome
passed on the changed TypeScript files with 17 warnings and nine informational
diagnostics. The separately run RDF pipeline check reproduced the starting
commit's three `json-signature` diagnostics in `admittedStatementItems`.

The Addendum A check ran mortgage-core and pay-an-invoice in a disposable
copy. Both reported 278 runs, zero disagreements and five blocked paths. The
five selected traces matched after removing `generated.commit`. The remaining
traces, outlines, manifest and index matched, and the disposable copy was
removed.

The sampled record corpus and both oracle files passed all four tests in
850.04 s. The full personal-agent run with `--maxWorkers=2` reported 520
passed, 77 failed and four skipped across 58 files. The remaining failures were
in these fixtures.

- Loopback listeners failed in `credentials`, `a2a`, `demo` scenario C,
  `conventional`, `public-reply`, `energy-durable`, the health
  `protected-disclosure` cases, `provider-http`, both dashboard suites
  and the `guarded-fetch-undici` setup hook.
- The SPARQ stand-ins could not spawn in `policy-config`, `policy-engine`,
  the policy-pinning A2A case and the industrial `protected-disclosure` cases.
  The MCP FIFO test could not spawn `mkfifo`.
- The real credential helper fixtures failed or timed out in
  `actions/providers.test.ts` and `actions/providers/credentials.test.ts`.
  A standalone Node child with piped stdio exited without echoing its input.

## Phase 2 (40j)

Stopped before implementation at `6741268ed` on
`claude/project-thread-ee3kq8-p922` under brief 40's stop rule. The verified
payment mandate cannot be projected by the required ODRL codec, and the
specified trust-file precedence would silently discard new peer pins from a
writer outside Addendum A6's allowed consumer changes. The memory, policy,
trust and snapshot codecs, including the snapshot memo, remain pending.

### Stop conditions

| Evidence | Result |
| --- | --- |
| [pay-an-invoice.json:243](scenarios/pay-an-invoice.json#L243), [pay-an-invoice.json:269](scenarios/pay-an-invoice.json#L269), [mandate.ts:191](src/mechanisms/mandate.ts#L191), [solid-odrl policy.ts:309](../solid-odrl/src/policy.ts#L309) | Provisioned the fixture's business agent through `Cast.add` and `mandateOf`. `TrustStore.load` and `loadMandate` accepted the signed mandate. `policyToRdf` then threw `TypeError: value is not iterable` in `escapeIri` for both policies. The writer looks up `ACTION_IRI[rule.action]`, and the table has no entry for `pay`. It returns no graph to which the same-node supplements in section 3.3 could be attached. |
| [policy-engine.ts:165](src/mechanisms/policy-engine.ts#L165), [mandate.ts:315](src/mechanisms/mandate.ts#L315), [solid-odrl policy.ts:599](../solid-odrl/src/policy.ts#L599) | For the fixture's `pay` request on `urn:op:payment`, the verified mandate returned `permit` and matched `urn:rule:monthly-payments`. Diagnostic round trips that removed `pay` or substituted `compensate` each returned `deny` with “no applicable grant in the mandate (deny by default)”. The existing evaluator's request-local normalization has different semantics from a durable vocabulary mapping. A complete R2 representation needs a design decision for the action and its reverse projection. |
| [gate-setup.ts:121](../../apps/agent-daemon/src/gate-setup.ts#L121), [gate-setup.ts:176](../../apps/agent-daemon/src/gate-setup.ts#L176), [gate-setup.ts:186](../../apps/agent-daemon/src/gate-setup.ts#L186), [gate.ts:332](../../apps/agent-daemon/src/gate.ts#L332), [gate-setup.test.ts:113](../../apps/agent-daemon/test/gate-setup.test.ts#L113) | The daemon provisions gates via SDK `saveAgent` and reads them via SDK `readAgent`. Under sections 3.5 and A6, provisioning creates `trust.ttl`, while the daemon's `pinPeer` still writes `trust.json` and returns success. With the required Turtle precedence, subsequent opens read the stale trust store. The daemon update path is outside A6's consumer exceptions. Its test also asserts that the JSON file is atomically replaced and mode 0600. |

The test files and ratchet planned in section 6 were not added. The direct
baseline codec probe reproduced the failure before any source change. A
second probe asserted that both encoder calls fail, native evaluation permits,
and the two diagnostic projections deny. These probes used the compiled
workspace packages and the existing fixture. No existing test assertions,
generated classes, ontology terms, context terms or guard allowances changed.

### Baseline checks

| Command | Result |
| --- | --- |
| `npx tsc -p tsconfig.build.json && node scripts/copy-generated.mjs` | Passed in `packages/agent-reference` with Node 24.22.3. |
| `node scripts/check-no-trace-change.mjs` | Passed after the compile. Mortgage-core and pay-an-invoice ran two and three live paths, respectively. Both reported 278 runs, zero disagreements and five blocked. Traces, outlines and manifest rows met Addendum A1. |
| `pnpm exec vitest run --maxWorkers=2 test/oracle-snapshot.test.ts` | Passed, one test. The live `test/oracle.test.ts`, Phase 2 acceptance tests and remaining package checks were not run after the stop. |
| `git diff --exit-code HEAD -- scenario-runs.json test/oracle/pre-rdf.json traces outlines profiles scenarios vocab/context/v1.jsonld src/wire/contexts.ts` | Passed. The manifest has 283 paths, 278 run, zero disagreements and five blocked. The manifest and oracle snapshot match HEAD byte for byte. |
| Repository search for `trust.json` in `packages/` and `apps/` | Confirmed the A6 consumers in [contacts.ts:108](../personal-agent/src/actions/contacts.ts#L108), [calendar/actions.ts:307](../personal-agent/src/actions/calendar/actions.ts#L307), [actions.test.ts:681](../personal-agent/src/actions/actions.test.ts#L681), [actions.test.ts:808](../personal-agent/src/actions/actions.test.ts#L808), [custody.test.ts:106](../personal-agent/src/pilot/custody.test.ts#L106) and [governance.ts:102](../personal-agent/src/pilot/governance.ts#L102). The daemon references above are additional. |

### Speed

`node scripts/profile-journey.mjs --iterations=3 --main-only` completed before
the stop. All iterations executed one main path per configuration.

| Measurement | Before | After |
| --- | ---: | --- |
| Mortgage baseline profile | 33,591 / 22,484 / 21,899 ms, median 22,484 ms | No implementation to measure |
| Mortgage data integrity profile | 31,431 / 20,472 / 16,996 ms, median 20,472 ms | No implementation to measure |
| 59 mortgage main state saves across seven stores | 284 ms in `MemoryStateStore.save` and 1,134 ms in `FileStateStore.save` | No implementation to measure |

The save probe replayed each live state into its own baseline file store,
timing its existing JSON serialization, file fsync, rename and directory
fsync together. A per-entry check of the states from this journey found no
violations of the Phase 1 `STORE_LIMITS`. The probe closed the stores and
removed its temporary directory. These are local measurements. Addendum A7's
profile medians were 7,399 and 8,015 ms, and section 2's 169 ms measured
`MemoryStateStore.save` rather than the durable write path. Neither the 3%
profile limit nor the 253.5 ms durable target was evaluated against RDF.

### Beads to file

| Label | Bead text |
| --- | --- |
| `needs:jesse` | Specify the store ODRL representation for the pilot's exact `pay` mandate action. Require both policies of the verified pay-an-invoice mandate to lower, recover the native action and rule order, and retain the permit for `urn:rule:monthly-payments`. Coordinate any codec change in `@jeswr/solid-odrl` separately from Phase 2. |
| `surface:apps/agent-daemon` | Extend the trust-file migration scope to the daemon's gate provisioning and pinning. Preserve the pin lease, in-lock revalidation, atomic replacement and file permissions. Prove that a confirmed peer is present on reopening a Turtle-backed gate and that legacy JSON gates remain readable. |
| `needs:jesse` | Confirm the durable-save budget against an equivalent before/after file-store benchmark with file and directory fsync enabled. The brief's 169 ms reference timed the memory store, while the local file-store baseline for the same 59 saves took 1,134 ms. |

The five broader follow-ups under [Other beads to file](#other-beads-to-file)
still apply. The only tracked change for 40j is this report section.

## Phase 2 (40k)

Implementation at baseline `6741268ed` on
`claude/project-thread-ee3kq8-p922`. Phase 2 is implemented. All 80 sampled
scenario/configuration groups passed across the initial partitions and targeted
reruns. The daemon's full run had 20 failures in loopback or subprocess tests.
R1, R2 and R3 supersede the stop conditions above.

### Changes

| Area | Implementation |
| --- | --- |
| ODRL actions | Rules and duties can carry an absolute profile action IRI. Known action IRIs still decode to their short names. Serializers reject invalid actions before escaping. The standard evaluator keeps its standard-action hierarchy. The policy codec projects native `pay` as `awp:pay` and restores `pay` for evaluation. [policy.ts](../solid-odrl/src/policy.ts#L282), [types.ts](../solid-odrl/src/types.ts#L15), [API report](../solid-odrl/etc/solid-odrl.api.md) |
| Policy graph | The loaded mandate produces a cached credential and policy projection, with named ODRL graphs and ordered standing and duty rules. Decode checks the exact credential, digest and graph. The policy supplements retain ordered rules and constraints, explicit empties, profile shape, inherited-party omissions, operand type and order, approval requirements and limits. The store restores clean absolute party, target and profile IRIs such as `did:web` on the same ODRL nodes when the standard writer cannot carry those schemes. [policy.ts](src/model/store/policy.ts#L168) |
| Memory | Typed scoped context items preserve labels, originals, signed evidence, reliance and precedence. Named ODRL graphs hold item terms and data-use policies. The snapshot gives each section its own named graph as required by §3.6. The memory and trust section families are identified by their typed entries. [memory.ts](src/model/store/memory.ts#L157), [state.ts](src/model/store/state.ts#L361) |
| Durable state | Version 2 N-Quads keeps the configured file path. The serializer memoizes native text, N-Quads payload blocks and position blocks per entry. The reader validates all sections and compares the reconstructed graph. The legacy reader normalises v1 state before its next save. The memory-store default save implementation is unchanged. Only the test constructor path installs the RDF round-trip check. [snapshot codec](src/model/store/state.ts#L361), [file store](src/store/state.ts#L445) |
| Trust | Typed Turtle retains ordered pins, rules, controllers and record keys. The SDK selects Turtle before JSON and fails closed on malformed Turtle. Provisioning and explicit SDK migration write Turtle using the suite serializer. The daemon pin operation uses the same SDK writer under its existing lease and identity revalidation. Legacy daemon gates update JSON until migrated. File sync, atomic rename, directory sync and mode 0600 apply to both formats. [trust.ts](src/model/store/trust.ts#L106), [setup.ts](src/setup.ts#L482), [gate-setup.ts](../../apps/agent-daemon/src/gate-setup.ts#L143) |
| Consumers | Calendar and contacts use the trust reader. Governance lists both files. The provisioning and explicit pin callers await the SDK writer. The personal-agent CLI holds its state lock until the asynchronous pin write finishes. [calendar/actions.ts](../personal-agent/src/actions/calendar/actions.ts#L308), [contacts.ts](../personal-agent/src/actions/contacts.ts#L108), [cli.ts](../personal-agent/src/pilot/cli.ts#L715), [governance.ts](../personal-agent/src/pilot/governance.ts#L102) |
| Pipeline | The snapshot writer's JSON exception is removed and the legacy reader exception follows the shared snapshot reader. Three pre-existing raw-JSON type findings referred to the same runtime context item. The private signature now narrows the existing `ContextItem.statement` property directly. The guard gained no allowance. [check-rdf-pipeline.mjs](scripts/check-rdf-pipeline.mjs), [agent.ts:3375](src/runtime/agent.ts#L3375) |

Authorization-server grants carry a different signed payload from an owner
mandate. The existing authority verifier lifts them into a native mandate.
The RDF reader reuses that verified lift for the header fields, checks the
exact signed grant bytes, and checks the restored policy against the native
mandate digest. The authorization-server mortgage case initially failed
because the store tried to parse the grant as an owner mandate. It passed on
the targeted rerun after this change.

The records-transfer scenario has two valid memory grants with the same native
policy ID and different targets. Naming both graphs solely by the native ID
merged those targets. Each memory policy now uses a deterministic projection
ID derived from its native ID and graph bytes. This ID is both the named graph
and the subject of the `odrl:Policy`. The node retains the native ID in
`odrl:uid`, which decode uses to restore each grant. Identical projections
share a graph. Mandates continue to use their native policy IDs as graph names.

The RDF store uses the exact stored JWS or document string with a digest. Open
entries use ordered `NamedValueCollection` and `ItemList` structures. The
recorded-message and approval models store their JWS in typed fields. The
signed mandate credential retains the existing embedded credential projection.
No edits were made to `policy-engine.ts` or `mandate.ts`. The SPARQ writer emits
a request-filtered projection with its own policy node and quad layout. The
generic ODRL serialization produces a different graph, so the SPARQ input stays
with its original writer.

### Tests and fixture adjustments

- [action-iri.test.ts](../solid-odrl/test/action-iri.test.ts) initially failed
  seven cases for profile and invalid actions. The 18 known-action cases
  passed against the baseline. The prior
  [policy.test.ts](../solid-odrl/test/policy.test.ts) assertion expected an
  unknown action rule to disappear. It now asserts the IRI projection.
- [policy-rdf.test.ts](test/policy-rdf.test.ts#L52),
  [state-file-format.test.ts](test/state-file-format.test.ts#L23) and
  [trust-rdf.test.ts](test/trust-rdf.test.ts#L83) initially failed at the missing
  codec imports. The focused tests cover the verified invoice mandate,
  `urn:rule:monthly-payments`, ordered rules and operands, unchanged-entry
  memo reuse, legacy reload, malformed state, delegated keys and Turtle
  refusal cases. Two additional tests replaced a true approval-use or trust
  refusal marker with false. Both failed first, then passed when the store
  enforced the native true-only marker.
- [state-rdf.test.ts](test/state-rdf.test.ts#L14) checks all 38 state sections with records captured from real saves, along
  with SHACL, the generic-section ratchet and N-Quads round trips. The
  [fixture source](test/fixtures/state-complete.README.md) describes the
  reference, daemon and local synthetic-provider runs used to assemble it.
  [state-corpus.test.ts](test/state-corpus.test.ts#L15) runs the Phase 1 sampler
  with the opt-in memory verifier, compares outlines and checks the decisions
  made under the decoded mandates.
- [gate-setup.test.ts](../../apps/agent-daemon/test/gate-setup.test.ts#L113)
  retains the atomic replacement, old descriptor and 0600 assertions while
  changing the target to Turtle. It also checks the reopened gate. The two
  added legacy and dual-format cases failed first on the baseline due to
  absent Turtle and JSON overwrites, respectively.
- [daemon.test.ts](../../apps/agent-daemon/test/daemon.test.ts#L2442) reads the two
  live snapshots through the SDK. The assertions on admitted context and held
  precedence retain their original conditions. Before that edit both reads
  failed on the N-Quads header. This fixture's trust write and the
  [outbound fixture](../../apps/agent-daemon/test/outbound.test.ts)
  now await provisioning. [custody.test.ts](../personal-agent/src/pilot/custody.test.ts)
  still writes a duplicated pin and verifies startup refusal and lock
  release. [actions.test.ts](../personal-agent/src/actions/actions.test.ts)
  writes valid trust through the SDK and tests invalid JSON and Turtle.
- The vocabulary test's foreign-term inventory now includes ODRL
  `hasPolicy`, RDFS `label` and security `controller`; the assertions
  are unchanged. [store-vocabulary.test.ts](test/store-vocabulary.test.ts)

### Generation and vocabulary

The package generator admitted `TrustPin`, `MandateRevocation` and
`PaymentReservation`. The SHACL property name for a revocation's native
`id` is `mandateId` because `id` is reserved by the generated wrapper.
Date-time wrappers validate their fields and the store retains the lexical
value, including offsets and fractional-second spelling. See
[codegen.config.json](codegen.config.json) and
[full-admission.json](src/generated/full-admission.json).

All store terms and their labels, comments, domains and ranges are in
[answerable-stores.ttl](vocab/answerable-stores.ttl#L406). The
[store shapes](vocab/answerable-stores.shacl.ttl) and pinned
[display context](vocab/context/store-v1.jsonld) document their projections.
The display-only context stays separate from the message context.

| Reused vocabulary | Terms in the store |
| --- | --- |
| Answerable | `Agreement`, `CompactJwsProof`, `EvidenceItem`, `LegacyCredentialSubject`, `NamedValueCollection`, `actionDigest`, `actor`, `approvalJws`, `approvalJwsDigest`, `asOf`, `at`, `claimType`, `conversation`, `digest`, `entryHash`, `evidence`, `format`, `jws`, `mandateCredential`, `method`, `party`, `protectedObject`, `recordApprovalBinding`, `recordBinding`, `recordIdentifier`, `role`, `sequence`, `statement`, `subject`, `terms`, `version` |
| RDF, RDFS and XML Schema | `rdf:type`, `rdfs:label`, and the XSD scalar datatypes, including `string`, `boolean`, `integer` and `dateTime` |
| PROV-O | `generatedAtTime` and `wasAttributedTo` |
| ODRL | Standard policy classes, actions, operators and operand individuals. `action`, `assignee`, `assigner`, `constraint`, `duty`, `hasPolicy`, `leftOperand`, `obligation`, `operator`, `permission`, `profile`, `prohibition`, `rightOperand`, `target` and `uid`. |
| VC Data Model | `VerifiableCredential`, `credentialStatus`, `credentialSubject`, `issuer`, `validFrom`, `validUntil` and `verifiableCredential`. |
| Schema.org | `ItemList`, `PropertyValue`, `itemListElement`, `name`, `position`, `propertyID` and `value`. |
| Security | `controller`, `proof` and the related `publicKeyJwk` vocabulary link. |

The following terms use the Answerable namespace.

- New classes
  `RuntimeSnapshot`, `StateSection`, `StateEntry`, `TypedStateSection`, `TypedStateEntry`,
  `TrustPin`, `MandateRevocation`, `PaymentReservation`, `TrustStore`, `PinnedKey`,
  `JsonWebKey`, `SourceAuthorityRule`, `PinnedRecordKey`, `RecordKeyDelegation`, `TrustController`,
  `TrustHold`, `TrustRefusal`, `OwnListEntry`, `RegisterEntry`, `Register`,
  `TrustRoot`, `MemoryScope`, `MemoryItem`, `ItemTerms`, `InheritedItemTerms`,
  `OriginalStatement`, `RelianceHold`, `KnownIdentifiers`, `StatementRefusal`, `RelianceBinding`,
  `DescriptionAddress`, `StoredMandate`, `StandingRule`, `DutyRule`, `ApprovalGrant`,
  `OrganisationApprovals`, `RecordHead`, `AuthoredProof`, `RecordedMessage`.
- New properties
  `policyFields`, `policyProfile`, `policyRightOperand`, `policyOperandDatatype`, `policyActionSpelling`,
  `policyRuleKind`, `policyApprovals`, `policyLimit`, `storedBytesDigest`, `stateVersion`,
  `section`, `sectionPresent`, `stateEntry`, `entryKey`, `entryValue`,
  `kid`, `admittedPurpose`, `effectiveUntil`, `stateMandateVersion`, `reservationPeriod`,
  `amountMinor`, `storeVersion`, `owner`, `pinnedKey`, `sourceAuthorityRule`,
  `trustController`, `recordKeyDelegation`, `keyRole`, `keySubject`, `endpoint`,
  `note`, `alg`, `publicKey`, `kty`, `crv`,
  `x`, `y`, `source`, `subjects`, `effectiveFrom`,
  `framework`, `identity`, `recordPublicKey`, `delegation`, `delegationDigest`,
  `trustMessage`, `trustWire`, `trustRefused`, `trustTasks`, `trustBlocked`,
  `authorizedFor`, `trustStatus`, `answersFor`, `registerEntry`, `answerTtlMs`,
  `trustRegister`, `memoryItem`, `compactProofDigest`, `identifiers`, `supersededBy`,
  `disputedWith`, `admittingDelivery`, `original`, `itemKind`, `accepted`,
  `admissionOrder`, `dataUseGrant`, `minimumGroup`, `deleteWithinDays`, `recipientMustBe`,
  `inheritedTerms`, `evidenceBytes`, `evidenceBytesDigest`, `memoryTask`, `relianceReason`,
  `refusedStatement`, `relianceBinding`, `descriptionAddress`, `mandateCredentialDigest`, `autonomousPolicy`,
  `withApprovalPolicy`, `standingRules`, `dutyRules`, `standingWhen`, `standingAllows`,
  `standingDuties`, `dutyKind`, `dutyItems`, `dutyOn`, `dutyParties`,
  `dutyWithinSeconds`, `dutyEvent`, `approvalDecisionName`, `approvalPayment`, `approvalUsed`,
  `approvalSigner`, `issuedAt`, `approvalItems`, `requestDigest`, `recordDirection`,
  `recordJws`, `recordJwsDigest`, `credentialsAdmitted`.
- Individuals
  `pay`, `anySubject`, `key-role/{actor,party,issuer}`, and
  `item-kind/{statement,memory,message,reading,content}`.

The Phase 1 untyped-record ratchet stands. Phase 2's
[state-generic-sections.json](test/fixtures/state-generic-sections.json) lists
`conversations`, `seen`, `outbox`, `effects`, `pending`, `domain`,
`tasks`, `transmissions`, `generatedConversations`, `notificationDuties`,
`duties`, `pendingPodGrants`, `emailChallenges`, `paymentOrders`,
`paymentOrderKeys`, `paymentReceipts`, `paymentTotals` and
`paymentReleases`. The store context adds zero `@json` terms.

### Generator follow-ups

Each suggested bead below carries `surface:packages/federation-codegen`.
The per-class results come from passing the class's original, unmodified shapes
to closed admission. The generator can emit isolated scalar leaves. The brief's
hand-held store models integrate those leaves with section membership, position
or exact-byte checks. The full-profile diagnostics are retained in
[full-admission.json](src/generated/full-admission.json).

| Hand-held class | Closed admission result | Bead text |
| --- | --- | --- |
| `RuntimeSnapshot` | Admitted in isolation. Integrated through the brief's hand-held store model. | Support `RuntimeSnapshot` with section or entry links, open values and section-level position. |
| `StateSection` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `StateSection` with section or entry links, open values and section-level position. |
| `StateEntry` | No runtime projection for `sh:or` or the enclosed `sh:nodeKind`. | Support `StateEntry` with section or entry links, open values and section-level position. |
| `TypedStateSection` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `TypedStateSection` with section or entry links, open values and section-level position. |
| `TypedStateEntry` | Admitted in isolation. Integrated through the brief's hand-held store model. | Support `TypedStateEntry` with section or entry links, open values and section-level position. |
| `TrustStore` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `TrustStore` with ordered values and projected nested trust references. |
| `PinnedKey` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `PinnedKey` with ordered values and projected nested trust references. |
| `JsonWebKey` | Admitted in isolation. Integrated through the brief's hand-held store model. | Support `JsonWebKey` with ordered positions and the native store fields. |
| `SourceAuthorityRule` | `sh:node` references an unprojected shape and requires a projected composite link. no runtime projection for `sh:or` or the enclosed `sh:nodeKind`. | Support `SourceAuthorityRule` with ordered values and projected nested trust references. |
| `PinnedRecordKey` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `PinnedRecordKey` with ordered positions and the native store fields. |
| `RecordKeyDelegation` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `RecordKeyDelegation` with ordered references or an exact JWS literal with a checked digest. |
| `TrustController` | Admitted in isolation. Integrated through the brief's hand-held store model. | Support `TrustController` with ordered values and projected nested trust references. |
| `TrustHold` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `TrustHold` with ordered positions and the native store fields. |
| `TrustRefusal` | Admitted in isolation. Integrated through the brief's hand-held store model. | Support `TrustRefusal` with ordered positions and the native store fields. |
| `OwnListEntry` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `OwnListEntry` with ordered positions and the native store fields. |
| `RegisterEntry` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `RegisterEntry` with ordered values and projected nested trust references. |
| `Register` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `Register` with ordered values and projected nested trust references. |
| `TrustRoot` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `TrustRoot` with ordered values and projected nested trust references. |
| `MemoryScope` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `MemoryScope` with ordered child links, native open values and related ODRL graphs. |
| `MemoryItem` | No runtime projection for `sh:or` or the enclosed `sh:nodeKind`. `sh:node` references an unprojected shape and requires a projected composite link. | Support `MemoryItem` with ordered child links, native open values and related ODRL graphs. |
| `ItemTerms` | No runtime projection for `sh:or` or the enclosed `sh:nodeKind`. `sh:node` references an unprojected shape and requires a projected composite link. | Support `ItemTerms` with ordered child links, native open values and related ODRL graphs. |
| `InheritedItemTerms` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `InheritedItemTerms` with ordered child links, native open values and related ODRL graphs. |
| `OriginalStatement` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `OriginalStatement` with ordered child links, native open values and related ODRL graphs. |
| `EvidenceItem` | Multiple NodeShapes for one canonical `targetClass`. The full profiles also reject unsupported `sh:xone`, `sh:nodeKind`, `sh:node` and `sh:pattern`. | Support `EvidenceItem` with ordered positions and the native store fields. |
| `RelianceHold` | No runtime projection for `sh:or` or the enclosed `sh:nodeKind`. `sh:node` references an unprojected shape and requires a projected composite link. | Support `RelianceHold` with ordered positions and the native store fields. |
| `KnownIdentifiers` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `KnownIdentifiers` with ordered values and projected nested trust references. |
| `StatementRefusal` | Admitted in isolation. Integrated through the brief's hand-held store model. | Support `StatementRefusal` with ordered positions and the native store fields. |
| `RelianceBinding` | Admitted in isolation. Integrated through the brief's hand-held store model. | Support `RelianceBinding` with ordered positions and the native store fields. |
| `DescriptionAddress` | Admitted in isolation. Integrated through the brief's hand-held store model. | Support `DescriptionAddress` with ordered positions and the native store fields. |
| `StoredMandate` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `StoredMandate` with ordered positions and the native store fields. |
| `StandingRule` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `StandingRule` with ordered positions and the native store fields. |
| `DutyRule` | `sh:node` references an unprojected shape and requires a projected composite link. no runtime projection for `sh:or` or the enclosed `sh:nodeKind`. | Support `DutyRule` with ordered positions and the native store fields. |
| `ApprovalGrant` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `ApprovalGrant` with ordered references or an exact JWS literal with a checked digest. |
| `OrganisationApprovals` | `sh:node` references an unprojected shape and requires a projected composite link. | Support `OrganisationApprovals` with ordered references or an exact JWS literal with a checked digest. |
| `RecordHead` | Admitted in isolation. Integrated through the brief's hand-held store model. | Support `RecordHead` with ordered positions and the native store fields. |
| `AuthoredProof` | Admitted in isolation. Integrated through the brief's hand-held store model. | Support `AuthoredProof` with ordered positions and the native store fields. |
| `RecordedMessage` | Admitted in isolation. Integrated through the brief's hand-held store model. | Support `RecordedMessage` with ordered references or an exact JWS literal with a checked digest. |

### Policy codec follow-ups

| Label | Bead text |
| --- | --- |
| `surface:packages/solid-odrl` | Define an opt-in lossless projection for ordered permissions, prohibitions, duties, constraints, profiles and right operands. Preserve duplicate native rule identifiers, exact action spelling and explicit empties. Keep standard ODRL parsing and evaluation semantics. |
| `surface:packages/solid-odrl` | Preserve explicit and inherited party fields separately during round trips. Define lossless handling for clean DID, target and profile IRIs in policy graphs while retaining validation for existing consumers. |
| `needs:jesse` | Decide the portable RDF vocabulary for the pilot's `approvals` and `limit` rule properties, item `minimumGroup`, and their relationship to ODRL constraints. The store currently uses local vocabulary and preserves native values. |

### Measurements and verification

The probe captured 59 native saves across seven stores from the baseline
mortgage main path, then replayed the same input bytes through the baseline and
changed builds. It timed five replays of each implementation on this machine.
Each file save includes file fsync, rename and directory fsync.

| 59 saves, milliseconds | Before, five replays | After, five replays | Median ratio |
| --- | --- | --- | --- |
| Durable | 6,890 / 11,003 / 8,042 / 7,129 / 6,119 | 3,923 / 3,638 / 4,136 / 8,144 / 7,306 | 4,136 / 7,129 = 0.58, within 1.5× |
| Memory | 451 / 372 / 407 / 336 / 293 | 189 / 188 / 210 / 690 / 357 | 210 / 372, with the original save implementation |

An intermediate build gave 4,800 ms durable and 218 ms memory medians. After
the memory grant identity fix, the same probe replayed all 59 saves again.
The final durable replays took 7,921 / 8,696 / 6,503 / 6,767 / 5,990 ms.
The 6,767 ms median was 0.95× the 7,129 ms baseline. The corresponding
memory replays took 270 / 288 / 221 / 212 / 241 ms, with a 241 ms median
compared with 372 ms before.

The first `profile-journey.mjs --iterations=3 --main-only` baseline medians
were 15,227 ms and 14,896 ms. After moving the exact-byte digest work fully
into the store layer, the medians were 9,976 ms and 10,487 ms. A second
baseline run from compiled HEAD in a disposable directory had medians
10,126 ms and 10,142 ms. Against that quieter baseline the data-integrity
change is +3.4%. Timings varied with concurrent work, so the same-CPU repeat
below records the paired result.

A back-to-back repeat pinned to one CPU gave 10,106 → 10,092 ms for the
baseline configuration and 10,103 → 10,604 ms for data integrity. The
data-integrity measurement was 5.0% higher in that pass. To reduce run-order
bias, a further same-CPU probe loaded compiled HEAD and 40k in one process,
discarded one warm-up for each combination, and alternated the order of the
same main journey. It gave the following medians.

| Configuration | Before, ms | After, ms | Change |
| --- | --- | --- | ---: |
| Baseline | 19,367 / 12,164 / 20,702 | 17,779 / 10,694 / 18,998 | 19,367 → 17,779, −8.2% |
| Data integrity | 18,905 / 15,854 / 21,756 | 15,068 / 10,504 / 23,654 | 18,905 → 15,068, −20.3% |

The disposable HEAD build used the runtime emitted before the standalone
ODRL bundler rejected the temporary host path in its publication
sanitizer. No temporary-build output was published or copied into the workspace.
The spread across the timing runs limits comparisons to this machine.

| Check | Result |
| --- | --- |
| Reference compile, `npx tsc -p tsconfig.build.json && node scripts/copy-generated.mjs` | Passed. |
| Solid ODRL tests, typecheck, `api:report`, `api:check` | Passed, 938 tests in 14 files. The API report was produced by the package script. |
| ODRL consumer type checks | `agent-mandate`, `agent-authz-verifier`, `pkg-memory` and `personal-agent` passed. No action-type change required edits in a consumer. Additional exploratory checks in packages with missing workspace build dependencies were inconclusive. |
| Reference typecheck and lint | Passed. Lint reported 679 warnings and 674 informational diagnostics. |
| Focused reference codec and vocabulary tests | Passed, 21 tests in five files. Added regressions cover non-standard policy IRIs, true-only state markers, repeated rule IDs and different memory grants sharing a policy ID. The two repeated-identity cases failed first and passed after the codec restored each occurrence separately. |
| Record corpus | Passed in 1,127.38 s with the unchanged untyped-record ratchet. |
| Durable replay | Reopened all seven stores after the 59 saves and checked the digest and native key order of each final snapshot. |
| Live RDF memory smoke | With `AWP_STORE_RDF=1`, five mortgage-core and pay-an-invoice paths preserved the recorded outlines. |
| Generated-artifact drift test | Passed. |
| Reference restart and Phase 1 regression tests | 148 of 150 initially passed. The payment restart and Pod mirror tests timed out under concurrent load. Both files passed on retry with `--testTimeout=300000`, 14 tests. |
| Daemon typecheck and targeted gate setup, daemon and outbound suites | Passed, 138 tests with `--maxWorkers=2 --testTimeout=30000`. |
| Daemon `npx vitest run --maxWorkers=2` | 273 passed, 20 failed. The failures are in loopback-dependent CSS, cloud and D-2 tests, CLI and production dependency subprocess output, and launchd's `python3` subprocess. Loopback bind and subprocess probes reported `EPERM`. The packaged help command and the pnpm dependency query both emitted output when invoked directly. |
| A6 personal-agent tests | Passed, 35 across actions and custody. Personal-agent typecheck also passed. |
| Workspace root guards, changed-file Biome and `check:codegen` | Passed. Eight generated projects. |
| `node scripts/check-rdf-pipeline.mjs` | Zero failures, 216 pre-existing explicit allowances. |
| `node scripts/check-no-trace-change.mjs` | Mortgage-core and pay-an-invoice ran two and three live paths. Both reported 278 runs, zero disagreements, five blocked. The compared traces, outlines and manifest rows passed. |
| `NODE_OPTIONS=--max-old-space-size=1100 npx vitest run --maxWorkers=2 test/oracle.test.ts test/oracle-snapshot.test.ts` in the reference package | All three tests passed in 310.18 s. The first execution's live worker exited unexpectedly. |
| Sampled corpus, `test/state-corpus.test.ts` with `--maxWorkers=2` | All 80 scenario/configuration groups passed across the partitioned runs and targeted reruns. The test enables `AWP_STORE_RDF=1`, compares recorded outlines and re-evaluates each observed intent with the decoded native mandate. |

The first state worker exited unexpectedly. The next reached the DID mortgage
configuration, where the public ODRL writer refused a native DID assigner.
The store-only projection carries those IRIs directly on the ODRL nodes.
The next execution used `STATE_CORPUS_PART=0` and `STATE_CORPUS_PART=1`,
each with a 1,100 MiB V8 heap cap. The first partition passed all 40 groups.
The second passed 21 groups, failed the authority-grant case and exited before
completing the last 18. A targeted retry of 17 of those groups passed 16 and
found the reused policy ID in records transfer. The salary benchmark exhausted
a 650 MiB worker heap and passed in isolation with a 1,600 MiB cap. On the final
codec, the targeted authority-grant, records-transfer and invoice groups passed
with the stricter assertion that every recorded sampled path appears. The
optional exhaustive `FULL_CORPUS=1` run was outside this verification.

The manifest remains 283 paths, 278 runs, zero disagreements and five
blocked. Its SHA-256 is
`7b490268f90bd3c0541322fc27e490253383aa1abdcf0b54ca50a63f2e78f53`.
The oracle snapshot SHA-256 is
`4f63d12f5e58b1d4a2f085c3d524b671663a1d96dd61c45ee875838d1308922f`.
Neither was edited. The reference package's full build and Turbo gate were
omitted as required by the brief.

### Remaining design work

The five existing follow-ups under [Other beads to file](#other-beads-to-file)
still apply. The standing payment vocabulary decision remains
`needs:jesse` … choose the long-term ODRL profile for the pilot payment action
and define a reversible migration from `awp:pay`. The native pilot rule
and evaluator already retain the exact `pay` action.
