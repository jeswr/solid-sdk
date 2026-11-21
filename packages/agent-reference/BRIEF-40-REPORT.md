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
