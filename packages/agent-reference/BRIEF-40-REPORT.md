<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 40 report

Phase 4 (40w) covers step 1. The full regeneration is assigned to the orchestrator.

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

## Phase 3 (40h)

<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

The Phase 3 fixture changes are in place. Acceptance is partly done because the
existing engine schema equality test requires the published files to use the
0.1 runtime schemas verbatim, including the `$id` version. Section 4 requires
those same published files to use the 0.2 schema literal and pinned context.
The 0.2 exports and the unchanged engine schemas and test assertion are all
present. Resolving the conflicting acceptance requirements needs a brief
decision. [engine.test.ts:209](test/engine.test.ts#L209)

The original branch tip `6215d3321` and the Phase 3 worktree both produce the same
three RDF-pipeline diagnostics in `AgentRuntime.admittedStatementItems`. The
guard retains 217 explicit allowances.
[agent.ts:3367](src/runtime/agent.ts#L3367)

The engine corpus count is also blocked in this offline worktree. Its adapter
block assertions pass, then the test compares the 163 available baseline paths
to all 168 runnable baseline manifest rows. Exactly five of those rows require
the unavailable `sparq-zk-result/5` adapter.
[engine.test.ts:99](test/engine.test.ts#L99)

### Changes

| Files | Change |
| --- | --- |
| [load.ts:19](src/engine/load.ts#L19) | Validate the fixture envelope, normalise 0.2 to 0.1 on the engine path and preserve the legacy 0.1 path. |
| [load.ts:61](src/engine/load.ts#L61) | Read the 0.2 fixture as RDF with its class, slug and root IRI. The graph also types trust entries with the classes specified in §3.5. |
| [contexts.ts:102](src/wire/contexts.ts#L102) · [contexts.ts:140](src/wire/contexts.ts#L140) · [contexts.ts:217](src/wire/contexts.ts#L217) | Give the fixture walker a bundled resolver, JSON-literal handling and indexed-map traversal. The same wire entry point calls the walker with its original defaults. |
| [store-contexts.ts:16](src/wire/store-contexts.ts#L16) | Pin the scenario context by SHA-256. The fixture resolver serves the scenario, ODRL and VC contexts. |
| [scenario-v1.jsonld:1](vocab/context/scenario-v1.jsonld#L1) · [scenario.ttl:1](vocab/scenario.ttl#L1) · [scenario-v1.README.md:1](vocab/context/scenario-v1.README.md#L1) | Map fixture keys to RDF, define the scenario vocabulary and document JSON-literal and slug-reference scopes. |
| [migrate-fixtures-jsonld.mjs:25](scripts/migrate-fixtures-jsonld.mjs#L25) · [fixture-digests.json:1](test/fixtures/fixture-digests.json#L1) | Capture the 145 original engine-object digests. Migrate and check the envelope with text edits only. |
| [profiles:2](profiles/mortgage.json#L2) · [scenarios:2](scenarios/mortgage-main.json#L2) | Migrate all 71 profiles and 74 scenarios. Each file gains a first `@context` key and the 0.2 schema literal. |
| [check-fixtures-jsonld.mjs:11](scripts/check-fixtures-jsonld.mjs#L11) | Check terms and parse every fixture with the graph reader, asserting the fixture IRI matches the filename. |
| [run-scenarios.mjs:160](scripts/run-scenarios.mjs#L160) · [oracle-snapshot.mjs:28](scripts/oracle-snapshot.mjs#L28) | Use the loaded engine case in ordinary runs. The expectation writer preserves the authored envelope and the snapshot reader selects the branch and method fields it uses. The reader search found no other direct engine-fixture readers requiring edits. |
| [export-schemas.mjs:11](scripts/export-schemas.mjs#L11) · [domain-profile.schema.json:1](schemas/domain-profile.schema.json#L1) · [agent-scenario.schema.json:1](schemas/agent-scenario.schema.json#L1) | Export the two file schemas with a required pinned context and 0.2 literals and schema IDs. |
| [package.json:31](package.json#L31) · [README.md:66](README.md#L66) | Export and document the new vocabulary, context, context README and graph reader. |

### Failing-first tests

The initial focused run failed all 27 new cases. The loader cases failed against
the 0.1-only parser, the RDF cases failed without `readCaseGraph`, and the
vocabulary case failed without a scenario context. The migration case also hit
`spawnSync EPERM` in the Vitest sandbox. Its in-process version failed on the
snapshot-only command before the migration check was implemented. No existing
test assertion was edited.

| Test | Coverage |
| --- | --- |
| [fixtures-jsonld.test.ts:26](test/fixtures-jsonld.test.ts#L26) | Migration and digest check, corpus-wide RDF roots and term admission, IRI and property indexes, native mandate JSON, mortgage-main script and branch list order, context pin and loader allow-list, ontology declarations and the JSON-literal ratchet. |
| [load-envelope.test.ts:39](test/load-envelope.test.ts#L39) | Equivalent 0.1 and 0.2 engine objects for both file kinds and every refused envelope. |
| [load-envelope.test.ts:63](test/load-envelope.test.ts#L63) | Undefined terms at the root, a nested step and a property-indexed entry. Nested unknown contexts and attempts to use the fixture JSON-literal option through `readDocument` are refused. |

### Vocabulary and design details

The new terms are the `awps:` declarations in
[scenario.ttl](vocab/scenario.ttl), one declaration per class or property.
They include `Scenario`, `DomainProfile`, `ScriptStep` and its instruction
classes, the file envelope and slug/index properties, and the properties for
fixture data, instructions, alternatives, expectations and faults. Phase 3
adds ontology declarations and JSON-LD mappings. It adds zero generated or
hand-held TypeScript model classes.

The context reuses Answerable actor, operator, party, subject, rule, operation,
method, version, terms, terms digest, content and activity properties. It uses
DPV `hasPurpose`, ODRL `action`, VC `issuer`, `validFrom` and `validUntil`,
Security `controller`, RDFS `label`, Schema.org `email`, `encodingFormat`,
`identifier`, `price`, `priceCurrency` and `text`, and standard RDF and XSD
list and literal terms. Phase 3 can run ahead of Phase 2, so its trust-class
and trust-property IRIs follow the names specified in §3.5 ahead of their
store declarations. [scenario-v1.jsonld:4](vocab/context/scenario-v1.jsonld#L4)

The JSON-literal ratchet is the 60-term table in the
[context README:20](vocab/context/scenario-v1.README.md#L20). Native mandate rule
arrays use the §4 fallback. Their shapes contain local action names, plural
constraints and native extensions that the bundled ODRL context cannot express
as authored. They remain JSON literals in the RDF view.

The streaming JSON-LD parser produced one own-list entry for the eight authored
entries in `mortgage-main` in a direct comparison. The fixture reader uses
the existing message conversion approach. The standard JSON-LD processor
resolves the bundled contexts and emits N-Quads, which `@jeswr/fetch-rdf` parses.
The trust graph test checks the authored multiplicity and key of every own-list
entry. All of this work is in `readCaseGraph`; ordinary loads check the envelope
by string comparison.

### Verification and speed

| Command | Result |
| --- | --- |
| `node scripts/migrate-fixtures-jsonld.mjs --snapshot` | Captured 145 digests before the other changes. |
| `npx tsc -p tsconfig.build.json && node scripts/copy-generated.mjs` | Compile-only passed on Node 24. |
| `node scripts/migrate-fixtures-jsonld.mjs` and `--check` | Migrated 145 files. The second migration changed zero. All 145 engine digests match. Reversing the two envelope edits recovers every original file byte-for-byte. |
| `pnpm run schemas` and `node scripts/export-schemas.mjs --check` | Passed. |
| `node scripts/check-fixtures-jsonld.mjs` | Parsed all 145 fixtures with zero failures. |
| `pnpm --filter @jeswr/agent-reference run typecheck` and `run lint` | Both passed. The package lint reported 647 warnings and 614 informational diagnostics. |
| `pnpm --filter @jeswr/agent-reference run check:rdf-pipeline` | Exit 1. The same three existing `json-signature` diagnostics at lines 3367, 3371 and 3374 reproduced on archived HEAD. |
| `pnpm run check:codegen` | Passed for eight generated projects. |
| `node scripts/check-no-trace-change.mjs` | Addendum A1 passed. The two runs reproduced five selected traces and both reported 278 runs, zero disagreements and five blocked paths. |
| `recordedJoint` for all six recorded paths | Verified hashes for `cohort-count`, `platform-income` and `salary-benchmark`. |
| `pnpm --filter @jeswr/agent-reference exec vitest run --maxWorkers=2` with the ten files below | 82 passed and two failed, both in `test/engine.test.ts`. |
| `git diff --check` and protected-path comparisons against HEAD | Passed. Manifest totals are 283 paths, 278 runs, zero disagreements and five blocked paths. The manifest, oracle, trace and outline bytes, message context, message reader and engine schemas match HEAD. |

The focused Vitest command used these file arguments. Both oracle files passed,
including all 163 baseline oracle paths. All 27 new tests passed.

```text
test/fixtures-jsonld.test.ts test/load-envelope.test.ts test/wire.test.ts
test/context-pins.test.ts test/store-vocabulary.test.ts test/oracle.test.ts
test/oracle-snapshot.test.ts test/engine.test.ts test/seam-scenarios.test.ts
test/needed-claims-scenarios.test.ts
```

Speed line for `node scripts/profile-journey.mjs --iterations=3 --main-only` on
this worktree, medians before to after in ms. Baseline **8,625 → 8,451** (−2.02%).
Data Integrity **9,343 → 8,319** (−10.96%). The first after-run overlapped an
RDF parser probe and medians were 9,741 / 10,228 ms. The isolated repeat used the
same code. The local pre-change medians already exceeded Addendum A7's historical
7,399 / 8,015 ms figures. The isolated post-change medians are 14.22% / 3.79%
above those historical figures.

### Beads to file

| Label | Bead text |
| --- | --- |
| `surface:packages/fetch-rdf` | Preserve all member nodes and index keys of JSON-LD property-indexed arrays in the streaming parser. Compare the mortgage-main own-list map against standard JSON-LD expansion and test nested lists alongside it. |
| `surface:packages/agent-reference` | Resolve the three pre-existing RDF guard findings in `AgentRuntime.admittedStatementItems` without growing the JSON-signature allow-list or changing statement admission. |
| `needs:jesse` | Resolve the conflict between the required 0.2 file exports and the unchanged engine test's 0.1 equality assertion. Decide whether the assertion may compare against the authoring schema while continuing to verify that the runtime schema stays at 0.1. |
| `needs:jesse` | Decide whether to link fixture slug references, replace opaque maps with nodes, support RDF framing back to fixture files, or adopt a `.jsonld` suffix. |
| `needs:jesse` | Decide whether outlines, the run manifest, exported schemas or settlement views need another representation. Keep the established published artifact compatibility in that decision. |

The remaining Phase 1 follow-up texts listed above still apply.

All fixture objects, trace artifacts and oracle decisions matched. The unchanged
schema equality assertion, offline optional adapter and pre-existing RDF guard
diagnostics prevent an all-green acceptance run. The trace-check copies, archived
guard copies and temporary test fixtures were removed.

## Phase 3 acceptance fixes (40i)

<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

- The one changed existing assertion is the published-schema equality check. It
  computes the expected schema from each runtime validator and applies the 0.2
  schema literal and `$id` plus the required pinned `@context`. It compares the
  full published schema to that result. A separate assertion checks both runtime
  schema literals at 0.1. [engine.test.ts:210](test/engine.test.ts#L210)
- `admittedStatementItems` narrows the existing `ContextItem.statement` type
  to a required property. This resolves all three signature findings with the
  same admission predicates and returned records. The guard reports zero
  failures and retains its 217 existing allowances. [agent.ts:3367](src/runtime/agent.ts#L3367)
- Package lint runs `check:rdf-pipeline` after Biome, including when invoked
  through Turbo. [package.json:60](package.json#L60)

| Check | Result |
| --- | --- |
| `pnpm exec tsc -p tsconfig.build.json` and `node scripts/copy-generated.mjs` | Compile-only passed on Node 24.22.3. |
| `pnpm run typecheck` | Passed. |
| `pnpm run lint` and `node scripts/check-rdf-pipeline.mjs` | Passed. Biome reported 647 warnings and 614 informational diagnostics. Both RDF guard invocations reported zero failures. |
| Workspace `pnpm run check:codegen` | Passed for eight generated projects. |
| `node scripts/export-schemas.mjs --check` | Passed. |
| `node scripts/check-fixtures-jsonld.mjs` and `node scripts/migrate-fixtures-jsonld.mjs --check` | Checked 145 RDF fixture reads and 145 matching engine digests. |
| `pnpm exec vitest run --maxWorkers=2` with the ten Phase 3 files listed above | All 84 tests passed with `.sparq` present, including all 11 engine tests. |
| `pnpm exec vitest run --maxWorkers=2 test/engine.test.ts` with `.sparq` moved aside | Ten passed. The existing corpus count failed at 163 of 168 runnable paths because five require `sparq-zk-result/5`. Restored `.sparq` after the run. |
| `node scripts/check-no-trace-change.mjs` | Passed after compilation. The two scenario runs reproduced five selected traces and preserved the outlines and manifest, with 278 runs, zero disagreements and five blocked paths. |

## Phase 3 graph read speed (40l)

<!-- AUTHORED-BY Codex GPT-6 -->

The isolated scenarios test fell from **30.89 s to 6.28 s** on Node 24.22.3.
Vitest's total duration, including imports, fell from 34.99 s to 10.40 s.
The slowest fixture read fell from **2,697 ms to 659 ms**. Five files
exceeded 1 s before the change and every file finished below 1 s afterward.

A temporary probe measured each file in the compiled reader, timing JSON-LD
expansion, context processing within expansion, and the subsequent N-Quads
parse. Context time includes recursive scoped context processing once.
The total also includes fixture admission and writing N-Quads.

| Corpus | Files | Total (s) | Expansion (s) | Of which context processing (s) | N-Quads parse (s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Scenarios | 74 | 32.990 → 6.289 | 29.983 → 3.610 | 22.095 → 2.381 | 2.121 → 1.751 |
| Profiles | 71 | 1.292 → 0.615 | 0.999 → 0.333 | 0.784 → 0.258 | 0.119 → 0.110 |

| Slowest files before the change | Total (ms) | Expansion (ms) | Of which context processing (ms) | N-Quads parse (ms) |
| --- | ---: | ---: | ---: | ---: |
| `scenarios/cohort-count.json` | 2,697 → 659 | 2,144 → 290 | 1,563 → 160 | 437 → 267 |
| `scenarios/salary-benchmark.json` | 2,574 → 402 | 2,392 → 249 | 1,740 → 129 | 131 → 111 |
| `scenarios/platform-income.json` | 2,178 → 220 | 2,024 → 123 | 1,476 → 79 | 128 → 73 |
| `scenarios/change-of-address.json` | 1,938 → 384 | 1,821 → 202 | 1,098 → 127 | 99 → 129 |
| `scenarios/mortgage-main.json` | 1,676 → 403 | 1,415 → 161 | 1,004 → 96 | 170 → 160 |

jsonld deep-cloned the active term map, including the large nested definitions
inherited from the Scenario type scope, each time it applied or reverted a scoped
context. A probe that shared resolved URLs alone kept the same processed-context
miss counts and left the large files above 1 s. The fixture resolver now copies
the term map and reuses its immutable entries. It uses jsonld 9's internal
resolver and retains its context metadata and reversion behavior. Context
processing calls and cache misses remained at 18,548 and 16,828 respectively
for the scenarios. [Fixture resolver](src/engine/fixture-context-resolver.ts)

The optimized resolver is local to fixture reads and uses the existing pinned
loader. Documents with non-string context values use the default resolver,
including when those values appear inside opaque JSON. All 145 fixtures matched
their baseline N-Quads SHA-256, root IRI, and dataset size. The timed scenarios
test used its original assertions and 60 s timeout.

Ten additional inputs matched the baseline reader's acceptance and graph output
or error, including nested contexts and context values inside opaque JSON.

| Check | Result |
| --- | --- |
| `pnpm exec tsc -p tsconfig.build.json` and `node scripts/copy-generated.mjs` | Compile-only passed. |
| `pnpm run typecheck` | Passed. |
| `pnpm run lint` | Passed with the existing 647 Biome warnings and 614 informational diagnostics. The RDF pipeline reported zero failures and 217 existing allowances. |
| `node scripts/check-fixtures-jsonld.mjs` and `node scripts/migrate-fixtures-jsonld.mjs --check` | All 145 fixture graphs and all 145 engine-object digests passed. |
| Focused Vitest with `--maxWorkers=2` | 68 tests passed across `fixtures-jsonld`, `load-envelope`, `whole-message-fixtures`, `wire`, `wire-proof-graphs`, and `context-pins`. |
| `node scripts/check-no-trace-change.mjs` | Both runs preserved the traces, outlines, and manifest rows. Each reported 278 runs, zero disagreements, and five blocked paths. |

## Phase 3 review fixes (40m)

<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

### Changes and failing-first tests

| Finding | Change | Regression |
| --- | --- | --- |
| Trust rule mapping | Source rules emit `awp:anySubject` directly and express explicit subjects as RDF lists. Trust claim types emit repeated `awp:claimType` literals. Updated the scenario context pin and documented the mapping. [scenario-v1.jsonld:117](vocab/context/scenario-v1.jsonld#L117), [scenario-v1.jsonld:145](vocab/context/scenario-v1.jsonld#L145), [load.ts:48](src/engine/load.ts#L48), [store-contexts.ts:17](src/wire/store-contexts.ts#L17), [scenario-v1.README.md:12](vocab/context/scenario-v1.README.md#L12) | The mortgage rule returned a blank list node for the wildcard before the fix. The test now checks the wildcard IRI, repeated claim type literals, and an explicit subject list. [fixtures-jsonld.test.ts:148](test/fixtures-jsonld.test.ts#L148) |
| IRI-valued fields | The graph projection links profile action claims through `odrl:action`. The corpus scan also found literal source IRIs in derivation rules, including scenario scripts and query grants, and literal adapter IRIs in effect steps. Those fields retain support for local names. The adapter vocabulary now describes both forms. [load.ts:73](src/engine/load.ts#L73), [scenario.ttl:83](vocab/scenario.ttl#L83), [scenario-v1.README.md:20](vocab/context/scenario-v1.README.md#L20) | The recycled-content join failed because its action was a literal. The profile and scenario corpus checks also failed on derivation sources and adapters. The tests distinguish semantic links from textual labels, email addresses, digests, and qualified local references. [fixtures-jsonld.test.ts:79](test/fixtures-jsonld.test.ts#L79), [fixtures-jsonld.test.ts:184](test/fixtures-jsonld.test.ts#L184) |
| Optional jsonld internals | The graph reader imports the optimized resolver on demand and caches the outcome. If the private module is unavailable, the same pinned loader runs with jsonld's default resolver. [fixture-context-resolver.ts:25](src/engine/fixture-context-resolver.ts#L25), [load.ts:132](src/engine/load.ts#L132) | Simulating an unexported resolver originally prevented package import. The test now verifies that the root and native loader work before the first resolver attempt and compares the exact N-Quads from both resolvers. [fixtures-jsonld.test.ts:257](test/fixtures-jsonld.test.ts#L257) |
| Order-sensitive fixture digests | The snapshot hashes the loaded object's JSON serialization, including JavaScript property enumeration order. This detects keyed-list patch reorderings and conservatively detects other object member reorderings. Recomputed the 145 entries from the pre-migration fixtures in local `origin/main` after verifying every legacy object against the previous canonical snapshot. All migrated fixtures match those ordered digests. [migrate-fixtures-jsonld.mjs:25](scripts/migrate-fixtures-jsonld.mjs#L25), [fixture-digests.json:3](test/fixtures/fixture-digests.json#L3) | Swapping two keyed step additions changed their append order while the original digest stayed equal. The test checks the engine patch order and requires distinct digests. [fixtures-jsonld.test.ts:33](test/fixtures-jsonld.test.ts#L33) |
| Runtime schema drift | The existing export test now asserts directly that both runtime validator shapes lack `@context`, then checks the published envelope delta. [engine.test.ts:219](test/engine.test.ts#L219) | Temporarily declaring an optional runtime `@context` triggered the new assertion. The validator sources were restored before verification. |

### Verification

The isolated scenarios corpus test passed in **7.56 s** on the final run and
**8.23 s** on the first passing run. Vitest reported **12.39 s** and **13.39 s**
respectively including transformation and module import. Phase 40l measured
**6.28 s** for the test before the corpus IRI assertion. Both 40m runs used
`pnpm exec vitest run --maxWorkers=2 --reporter=verbose test/fixtures-jsonld.test.ts -t 'checks every scenarios document'`.

| Check | Result |
| --- | --- |
| `pnpm exec tsc -p tsconfig.build.json && node scripts/copy-generated.mjs` | Compile-only passed on Node 24.22.3. |
| `pnpm run typecheck`, `pnpm run lint`, and `node scripts/check-rdf-pipeline.mjs` | Passed. Biome reported 647 warnings and 614 informational diagnostics, matching 40l. The RDF guard reported zero failures and 217 existing allowances. |
| Workspace `pnpm run check:codegen` | Passed for eight generated projects. |
| `node scripts/export-schemas.mjs --check`, `node scripts/migrate-fixtures-jsonld.mjs --check`, and `node scripts/check-fixtures-jsonld.mjs` | Passed. The 145 engine digests match and all 145 fixture graphs parse. |
| Node loader probe with the internal resolver path blocked | Both resolvers produced the same N-Quads SHA-256 for all 145 fixture graphs. |
| `node scripts/check-no-trace-change.mjs` | The two runs reproduced five paths and preserved the traces, outlines, and manifest rows. The manifest still records 283 paths, 278 runs, zero disagreements, and five blocked paths. |
| `recordedJoint` | Verified all six recorded trace hashes across `cohort-count`, `platform-income`, and `salary-benchmark`. |
| The ten 40i Vitest files with `--maxWorkers=2` | All 88 tests passed in 618.31 s, including both oracle files and the full engine suite with `.sparq` present. Phase 40i established that five runnable paths require that adapter. |
| `git diff --check` and protected-path comparison against `d257ed2da` | Fixture files, runtime schema source, message context and reader, oracle data, manifest, traces, and outlines match the reviewed head. |

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

## Phase 2 CI fix (40n)

<!-- AUTHORED-BY Codex GPT-6 -->

Baseline `1c45e5026`. Both solid-odrl readers skip rules and duties with
unrecognized actions by default. `PolicyReadOptions.allowedActionIris` accepts
extension actions by exact IRI match. Standard actions still decode to their
short names and take precedence when a node supplies multiple actions. The
store codec opts into `awp:pay` and restores native `pay`, including the
verified invoice mandate's permit for `urn:rule:monthly-payments`. Writers
continue to preserve clean absolute action IRIs.

Node 24.22.3 and pnpm 10.4.1. The default-skip regression failed before the
reader change. The allow-list test checks rules, permission duties and
obligations in both reader entry points, including case-sensitive matching.

| Check | Result |
| --- | --- |
| solid-odrl tests, `api:report`, `api:check` | 939 tests passed across 14 files. API Extractor generated and verified the report. |
| rdf-engine tests | 224 passed across 11 files with the coverage gate enabled. The ordinary run passed 223 tests and hit `EPERM` while capturing the WASM-copy CLI's output. A local rerun supplied file-backed stdout to that real subprocess and kept the package and tests intact. |
| Agent-reference phase 2 | 21 passed in `state-rdf`, `state-file-format`, `trust-rdf`, `policy-rdf`, and `store-vocabulary`. |
| Agent-reference restart and regression suites | 231 passed across 20 files. The primary batch covered `email`, `forum`, `durable-capabilities`, `pod-mirror`, `runtime-graph-ingress`, `ledger-file-format`, `record-rdf`, `rdf-pipeline`, `store-quads`, `store-vocabulary`, `codegen`, `agreements`, `general-duties`, and `single-use`. The two follow-up batches covered `capabilities-b-adversarial`, `content`, `dataset-query`, `proofs`, `joint`, and `email-endpoint-alternative`. |
| Daemon and personal-agent restart checks | 138 daemon tests passed in `gate-setup`, `daemon`, and `outbound`. 38 personal-agent tests passed in `mortgage-durable`, `custody`, and `actions`. |
| Typecheck and Biome | Typecheck passed for solid-odrl, rdf-engine, agent-reference, agent-daemon, and the seven consumers below. Changed-file Biome, package lint for solid-odrl and agent-reference, and `lint:root` passed. Package lint reported existing warnings. |
| RDF pipeline and traces | The RDF guard reported zero failures and 216 explicit allowances. Mortgage-core and pay-an-invoice ran two and three live paths. Both reported 278 runs, zero disagreements and five blocked. The trace, outline and manifest comparisons passed. |

The `package.json` search found these seven additional workspace consumers of
`@jeswr/solid-odrl` beyond rdf-engine and agent-reference. The two apps ran
with lockfile dependencies installed offline in a disposable workspace copy.

| Workspace consumer | Test result |
| --- | --- |
| `@jeswr/agent-authz-verifier` | 141 passed in 5 files |
| `@jeswr/agent-mandate` | 858 passed in 12 files |
| `@jeswr/app-access-manager` | 181 passed in 17 files |
| `@jeswr/app-issues` | 720 passed in 47 files |
| `@jeswr/personal-agent` | 520 passed, 77 failed, 4 skipped, and 2 unhandled loopback errors across 58 files |
| `@jeswr/pkg-memory` | 809 passed in 15 files |
| `@jeswr/pod-access` | 1,183 passed in 26 files |

The full personal-agent run hit the sandbox's loopback and subprocess
restrictions, including `listen EPERM`, `spawnSync EPERM`, and dependent
timeouts. The failure, skip and unhandled error counts match the earlier
sandbox run. [Brief 36J report](../personal-agent/BRIEF-36J-REPORT.md)

The full workspace gate was attempted in the disposable copy. It stopped at
`@jeswr/solid-webauthn-reauth` because `@simplewebauthn/browser` was absent in
that copy. The agent-reference build was limited to compiling and copying
generated modules in the worktree. The trace check ran in its own disposable
copy, and the checked-in trace, outline and manifest files retain their bytes.

## Phase 2 review fixes (40o)

<!-- AUTHORED-BY Codex GPT-6 -->

Baseline `776a9d253`. Node 24.22.3 and pnpm 10.4.1. The 24 initial
regressions failed on the review baseline. Five additional regressions for
JSON node count, string length, surrogate entry keys, deeply inherited
terms and collisions between entry graphs also failed against the baseline encoder.

| Finding | Fix and regression |
| --- | --- |
| Rules and duties attach to the wrong RDF node | The ODRL writer reports each lowered object's subject. The store resolves the reported IRI or skolemized blank-node identity before attaching position, field presence, approvals and limits. Tests cover the assigner, profile and duty-target collisions in both projection modes, plus the persisted precedence hold. [Policy codec](src/model/store/policy.ts) · [Policy regressions](test/policy-rdf.test.ts) · [File regressions](test/state-file-format.test.ts) |
| A save can replace a readable file with bad data | The save decodes the outgoing layout and entry blocks, checks the canonical encoding and compares the result with the legacy JSON projection of the input. Validation is reused for byte-identical entries. A link or shared subject across entries triggers the full reader to verify the combined graph. Tests check that malformed RDF, an encoder exception, a different decoded state and a cross-entry link preserve the last readable file. [File save](src/store/state.ts) · [File regressions](test/state-file-format.test.ts) |
| Legacy state can contain values outside the RDF projection | The local policy projection carries RDF-safe identifiers such as `urn:x:1` and preserves a non-IRI policy ID as a literal on a deterministically named node. Snapshot keys and open values retain lone surrogates in RDF JSON literals. Values larger or deeper than the named-value projection also use compact RDF JSON literals. Snapshot sections have no separate structural or fixed file-size cap because that would reject data already admitted by the runtime. The ledger's limits and gate admission still apply at their existing boundaries. [Store fields](src/model/store/common.ts) · [File regressions](test/state-file-format.test.ts) |
| Standard action IRIs change the evaluation outcome on round trip | The public writers require short names for actions from the standard table. The store retains full native spelling in its local supplement. The regressions exercise `odrl:read` and `acl:Append` alongside a short-name permission. [ODRL regression](../solid-odrl/test/policy.test.ts) · [Policy regressions](test/policy-rdf.test.ts) |
| The Turtle trust writer rejects native trust fields | Safe identifiers and XSD date-times keep their RDF forms. Accepted local identifiers and timestamp spellings use literals where needed. The tests load the original data through the trust verifier, write Turtle, validate the graph and reopen it through the verifier. [Trust codec](src/model/store/trust.ts) · [Trust regressions](test/trust-rdf.test.ts) |
| Sparse section arrays can produce unreadable files | The encoder rejects a sparse section before writing. The regression checks both the direct encoder and the durable save and verifies the original bytes. [Snapshot codec](src/model/store/state.ts) · [File regressions](test/state-file-format.test.ts) |

A populated v2 snapshot from the baseline encoder reopened with the same
native state. The v1 migration tests also reopen the resulting v2 files.
The durable SHACL shapes declare the trust and entry-key literal forms,
and the package generator refreshed the input locks and admission report.

| Check | Result |
| --- | --- |
| solid-odrl | 941 tests passed across 14 files. API report generation and verification passed. |
| rdf-engine | All 224 tests passed with coverage enabled after routing the WASM-copy subprocess stdout through a file descriptor. The ordinary run passed 223 tests and hit `spawnSync EPERM` on that subprocess. |
| Agent-reference Phase 2 and codec guards | 54 tests passed across eight files, including codegen drift. |
| Agent-reference restart and regression suites | All 277 tests passed across 24 files on the final combined run, including Phase 2. The first run timed out in Pod mirror and overlapped regeneration during the drift check. |
| Daemon and personal-agent restart suites | All 138 daemon tests and 44 personal-agent tests passed on the final codec. The personal-agent run included mortgage, custody, actions, CLI, health, industrial and the 220-message prepared-cache test. |
| Typecheck and lint | Typecheck passed for agent-reference, solid-odrl, rdf-engine, agent-daemon and the seven direct consumers. Changed-file Biome, targeted package lint and root lint passed. Existing lint warnings remain. |
| RDF pipeline and traces | Zero RDF pipeline failures and 216 existing allowances. The trace check matched the five live data paths in both default and RDF-verified memory modes, with 278 runs, zero disagreements and five blocked entries. |
| Direct solid-odrl consumers | Agent authz verifier 141, agent mandate 858, pkg-memory 809, pod-access 1,183, access-manager 181 and issues 720 passed. The app suites used a disposable workspace with offline lockfile installs. |

The initial full personal-agent run reported 513 passed, 84 failed and four
skipped, with two unhandled loopback errors. The 77 failures from the 40n
sandbox run recurred. The seven additional failures were test timeouts,
all of which passed within the existing timeouts in the final targeted run
after save verification began reusing validated entry blocks.

The full workspace gate was blocked in the disposable copy by missing
`@capacitor/core` for suite-native. Retrying with a full offline install
stopped on the uncached, lockfile-pinned federation-registry tarball.

## Phase 2 re-review fixes (40p)

<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

Baseline `c5ac74729`, which merges `origin/main` over reviewed commit
`ec26b4526`. Tests used Node 24.22.3, pnpm 10.4.1, and two Vitest workers.

| Finding | Fix and regression |
| --- | --- |
| N1 | Typed snapshots preserve the original instant for owner and organisation approvals, trust holds and pins, mandate revocations, admitted and held memory facts, and agreements. Generated pin and revocation nodes retain a queryable date-time alongside the source spelling when needed. A signed minute-precision owner approval survives a durable save and reopen with the exact timestamp and JWS, and the gate returns the same decision as the memory store. Coverage includes an explicit offset and earlier v2 Agreement timestamps. |
| N2 | The local Agreement model reuses the protocol graph and applies the store's RDF JSON escape where necessary. An operation version containing lone high and low surrogates, a replacement character, and an astral character round-trips exactly. |
| N3 | Snapshot reads and writes are bounded at 256 MiB and one million quads. Trust reads are capped at 64 MiB, with additional Turtle limits of 128 Mi characters of expanded term text and 250,000 quads. Those limits leave room for accumulated conversations and signed records and contain Turtle prefix amplification. Inherited terms accept 32 levels. Reads and saves report a clear error at the 33rd level. Regressions exercise both paths, an oversized sparse file, and prefix expansion in a small Turtle document. |
| N4 | The solid-odrl README and skill describe standard action IRI rejection in the RDF and JSON-LD decision-record writers. Both writer regressions accept the short `append` action and reject its standard ACL IRI on an active duty. The package regenerated and verified the API report after documenting `PolicyWriteOptions`. |

The signed-approval, typed-instant, Agreement surrogate, inherited-depth, and
Turtle expansion regressions failed on the merged review baseline. The
decision-record writers already rejected the IRI on that head. Their tests
protect the behavior introduced in 40o and both failed against `776a9d253`,
before the standard-IRI rejection was introduced.

### Save timings

The diagnostic memory store had been parsing and materializing the entire
snapshot at every save. Both stores now verify changed layout and payload
blocks and reuse verified blocks when their bytes are unchanged. If the
decoded entry has identical JSON, including nested order, the reader checks the
parsed quads against the original graph. A changed native projection still
requires canonical re-encoding. Cross-entry links and subject collisions still
go through the full reader. An injected extra quad with unchanged JSON is
rejected before rename, and a retry after an encoder error succeeds.

The save benchmark used the populated state fixture, updated one nested value
per save and appended 25 entries over 50 saves. Each mode ran four times and
the table reports the median. The encode-and-fsync control used the same
encoder and durable write steps with the verification bypassed solely for
measurement. CLI and corpus rows use Vitest's test-body duration from isolated
runs.

| Workload | Review baseline | Final |
| --- | ---: | ---: |
| 50 saves, encode-and-fsync control | 441 ms | 408 ms |
| 50 saves, durable file store with verification | 1,229 ms | 787 ms |
| 50 saves, memory store with `AWP_STORE_RDF=1` | 5,928 ms | 662 ms |
| State corpus, `cohort-count/baseline` | 118.50 s | 79.31 s |
| Personal-agent, `src/pilot/cli.test.ts` | 11.67 s | 10.39 s |

The baseline verification increased the durable benchmark to 2.78 times its
encode-and-fsync control. Final durable saves were 36% faster than the review
baseline. The measured corpus case was 33% faster, and the CLI passed within its
existing 20-second timeout. The corpus measurement covers one case.

### Verification

| Check | Result |
| --- | --- |
| Agent-reference Phase 2 and restart regressions | 284 passed in 24 files, including the generated-model drift test. The final codec rerun passed all 46 tests, and a populated snapshot from the earlier v2 encoder reopened with identical state. |
| Agent daemon restarts | 138 passed in gate setup, daemon, and outbound. |
| Personal-agent restarts | All 46 targeted cases passed across the combined run and the isolated mortgage rerun. One mortgage case timed out in the concurrent run. All three mortgage cases passed in isolation within their existing timeouts. |
| Solid ODRL | 943 passed in 14 files. API report generation and verification passed. |
| RDF engine | 224 passed in 11 files with coverage enabled. The ordinary run hit `spawnSync EPERM` in the WASM-copy CLI test. The rerun used file-backed stdout for that subprocess. |
| Other direct solid-odrl consumers | Agent authz verifier 141, agent mandate 858, pkg-memory 809, pod-access 1,183, access-manager 181, and issues 720 passed. The two app suites used an offline install in a disposable workspace. |
| Typecheck and lint | Agent-reference, agent-daemon, solid-odrl, rdf-engine, and all direct consumers passed typecheck. Changed-file Biome, both changed package lints, and root lint passed. |
| RDF pipeline and traces | The guard reported zero failures and 216 existing allowances. Default and RDF-verified memory modes reproduced all five selected live paths and preserved the traces, outlines, and manifest rows. Both runs reported 278 runs, zero disagreements and five blocked paths. |

Agent-reference was compiled with `tsc -p tsconfig.build.json` and
`scripts/copy-generated.mjs`. Temporary package copies were removed.

The full personal-agent run reported 520 passed, 77 failed, four skipped, and
two unhandled loopback errors. Its failing test names matched the 40n sandbox
run, which hit loopback and subprocess restrictions and dependent timeouts.

## Merge fixes (40q)

<!-- AUTHORED-BY Codex GPT-6 -->

In all four failures, `localAudit` printed `BREACH gate ledger integrity failure`.
Main's offline audit parsed `state.json` as JSON. Phase 2 writes N-Quads to that
same path, so parsing failed on the first `<`. The two retention cases had
already started the daemon successfully by the time they ran the offline audit.

The offline audit now uses the same read-only snapshot decoder as startup. It
uses the saved head to verify the committed prefix, retention checkpoints and
witnesses. The decoder treats only a missing file as empty and propagates other
read errors. The crash test runs the same assertions against RDF and legacy JSON
checkpoints, including byte-for-byte preservation of the snapshot and ledger.

The reference compile and generated-file copy passed, as did all 47 requested
store tests and the daemon typecheck. The trace check passed against the committed
artifacts in a temporary copy. The worktree run flagged its trace index, which
already lacked 273 committed rows.

All four reported daemon cases passed. The refused-successor-revision restart
took 1.70 seconds in the full daemon run and 1.60 seconds in isolation, within its
5-second limit. The full run passed 295 tests and hit 20 failures involving
blocked loopback listeners or subprocess output. The packaged CLI's help and
JSON and CSV exports passed when subprocess output was captured in files.

## Review 40r5 fixes

<!-- AUTHORED-BY Codex GPT-6 -->

- Saves check that each new layout, payload, and policy block starts with a
  named subject and ends with a complete statement and newline. Each block must
  match the canonical N-Quads of its parsed graph. The memo reuses those checks
  for unchanged blocks. Regressions inject terminated and unterminated comments
  and verify that the previous snapshot survives both faults.
- The snapshot head carries a SHA-256 digest of the canonical section, entry,
  and policy blocks. Startup and offline audit verify it before returning any
  state. Tests truncate the populated fixture at all 40 entry boundaries, cut
  each section at the same boundaries while preserving the later graphs, and
  change a value while preserving the entry count. Older RDF snapshots without
  a digest fail closed. Trusted version 1 JSON still opens and migrates on save.
- N-Quads and Turtle readers apply their existing quad and term budgets while
  N3 tokenizes. The regressions put too many small statements under the byte
  cap and check that parsing stops before it reaches a malformed tail. Local
  state and trust file reads also refuse invalid UTF-8.
- Inherited item terms keep their 32-level depth limit. Each fact can now
  expand at most 8,192 inherited references on read or write. A shallow chain
  of diamonds exercises the expanded reference limit.

With `AWP_STORE_RDF=1` on Node 24, each run performed 50 memory saves of the
populated fixture. It changed one nested value on each save and added 25
entries across the run. The before and after measurements used the same
workload and four runs each.

| Build | Four runs (ms) | Median (ms) |
| --- | --- | ---: |
| Before, `7a802d02e` | 468, 278, 318, 252 | 298 |
| After | 497, 315, 284, 266 | 299 |

The library compile and generated-file copy passed. All 97 agent-reference
tests passed, including the store, state RDF, trust, ledger, durable capability,
vocabulary and codegen drift tests. All 197 fetch-rdf tests and its test
typecheck passed. The RDF pipeline check reported zero failures and 216
existing allowances. The trace check matched both scenarios across five live
paths and preserved the trace, outline and manifest contents.

Daemon typecheck passed. The full daemon run passed 295 tests and reported 20
failures, matching the previous sandbox run. The following 17 cases tried to
bind to `127.0.0.1`. The first two reported `listen EPERM` directly, and all
15 cloud cases timed out waiting for their test port reservation.

- `demos/d2-spending-limits.test.ts` — hostile email and A2A can propose while transfers and cumulative spending remain executor-gated.
- `test/css.test.ts` — in-memory CSS pod and direct binding through signed halt.
- `test/cloud.test.ts`
  - Requires explicit dev configuration and a trusted host before opening a store or listener.
  - Retains private persistent state and reads only explicit Key Vault injected model keys.
  - Refuses local or unclassified bindings `imessage`, `signal`, `whatsapp`, `mcp`, and `unknown` (five cases).
  - Requires an A2A receiver and refuses a missing A2A binding.
  - Exposes bounded A2A and probes, preserves authorization bytes and suppresses provider errors.
  - Aborts the listener and waits for daemon drain before closing credentials.
  - Closes the composition on daemon and listener startup failures.
  - Retains the file lease through inbound cancellation and drain, including a released daemon lease.
  - Releases startup leases after factory failure or cancellation during composition.
  - Catches synchronous receiver failures and bounds receiver response bytes.
  - Bounds concurrent A2A verification even for pipelined requests on one connection.

The other three failures involved subprocess output. The packaged CLI received
empty help output, the installer hit `spawnSync python3 EPERM` during plist
validation, and the production package test received empty dependency JSON.
All three passed on rerun with subprocess output captured in temporary files.

## Review round 6 fixes

<!-- AUTHORED-BY Codex GPT-6 -->

- The snapshot reader checks that each memory payload, item, terms node, and
  inherited reference uses the ID its writer assigns. It rejects a shared
  chain in under 500 ms with either one or 40 entries. A separate case checks
  sharing below a correctly scoped root.
- The 8,192-reference limit now covers the whole RDF snapshot. The save path
  counts both new and reused entries against that limit. Tests cover the
  limit across memory sections, a successful round trip, and preservation of
  the previous file when a save exceeds the limit.
- The writer reuses the RDF graph for an identical ODRL policy within an
  entry. The reader takes inherited reference IDs directly from the RDF
  list. With 3,000 references sharing a policy, the measured file save went
  from 7.19 s to 2.92 s and load went from 4.40 s to 2.29 s.
- New and legacy ledger segments use the same fatal UTF-8 decoder as local
  state and trust files. Tests cover both formats, including a bad append
  after a cached N-Quads prefix.
- The README explains that the unkeyed digest catches accidental damage,
  anyone who can write the file can recompute it, and version 1 JSON has no
  digest. It describes the ledger's role in tamper evidence.

With Node 24 and `AWP_STORE_RDF=1`, four runs of 50 memory saves took
466, 432, 448, and 460 ms. Each run used the populated fixture, updated one
nested value per save, and appended 25 entries. The median total was
454 ms against the 1 s target.

The library compile and generated-file copy passed. The trace check passed
across five scenario paths, with 278 manifest runs, zero disagreements, and
five blocked paths. All 126 tests passed across the seven store, ledger,
state RDF, and policy RDF test files. Daemon typecheck passed.

The full daemon run passed 297 tests and reported 42 failures. Three passed
on rerun with subprocess output captured in temporary files. These were
packaged CLI help and JSON/CSV exports, launchd plist validation, and
production dependency packaging. The remaining 39 failed to bind to
`127.0.0.1` with `listen EPERM`:

- `demos/d2-spending-limits.test.ts` — hostile email and A2A proposals with
  executor-gated transfers and cumulative spending.
- `test/css.test.ts` — in-memory CSS pod and direct binding through signed halt.
- `test/cloud.test.ts` — 37 cases
  - Private persistent state and explicit Key Vault model keys.
  - Refusal of `imessage`, `signal`, `whatsapp`, `mcp`, and `unknown`
    bindings (five cases).
  - Missing A2A receiver and binding.
  - Bounded A2A and probes, preserved authorization bytes, and suppressed
    provider errors.
  - Signed message admission on `/a2a` (compact), and on `/answerable`
    (compact and document) (three cases).
  - Empty 503 on decision commit failure on `/a2a` and `/answerable` (two cases).
  - Direct HTTP route, media types, and byte limit before the gate.
  - HTTP 200 admission and refusal at the A2A byte limit with default and
    explicit receivers (two cases).
  - Closing unfinished oversized chunked uploads on both routes at 415,
    413, and the two 417 cases per route (eight cases).
  - Replying and freeing a slot when final bytes and EOF arrive together
    for fixed-length and chunked uploads on both routes (four cases).
  - Reply after the client half-closes on either route (two cases).
  - Shared upload slots and reclamation on disconnect.
  - Listener abort, daemon drain, and credential close order.
  - Composition close on daemon and listener startup failures.
  - Retention of the file lease through inbound cancellation and drain.
  - Release of startup leases after factory failure or cancellation.
  - Synchronous receiver failures and response size bounds.
  - Shared in-flight limit for pipelined requests.

## Review round 7 fixes

<!-- AUTHORED-BY Codex GPT-6 -->

- The named-value reader checks the IDs the writer assigns to collection
  entries, nested objects and lists, and nulls. The snapshot reader also checks
  the root value ID for each field. Stored policy fields use the original
  subject kept in `odrl:uid` because the writer renames the policy subject
  after assigning the value IDs.
- The 8,192-reference limit applies to each memory item or precedence hold.
  The reader still checks the IDs of inherited references and keeps the file
  limits of 256 MiB and one million quads. The regression test saves and reloads
  three holds with 3,000 references each, then verifies that an oversized hold
  is refused and the previous file is preserved.
- The sharing tests require rejection in under 500 ms. They cover an
  18-level shared-sibling probe in both a domain entry and a typed statement,
  and shared inherited terms at the root and deeper in the tree. Separate
  round-trip tests cover empty and nested objects and lists, repeated values,
  nulls, booleans, literals, IRIs, and exact finite numbers.

Four Node 24 runs of 50 RDF-verified memory saves took 625, 542, 438, and
400 ms. The median was 490 ms against the 1 s target. Each run used the
populated state fixture, changed one nested value per save, and added 25
entries. The library compile and generated-file copy passed. The trace check
passed across five scenario paths with 278 manifest runs, zero disagreements,
and five blocked paths.

All 164 tests passed across the 11 store, ledger, named-value, policy, and
message model test files. The reference package typecheck passed. The RDF
pipeline check reported zero failures and 216 existing allowances.

Daemon typecheck passed. The full daemon run passed 297 tests and reported 42
failures. The packaged CLI help and exports, launchd plist validation, and
production dependency packaging passed on rerun with subprocess output
captured in temporary files. The remaining 39 cases hit `listen EPERM` on
`127.0.0.1`.

- `demos/d2-spending-limits.test.ts` — hostile email and A2A proposals with
  executor-gated transfers and cumulative spending.
- `test/css.test.ts` — in-memory CSS pod and direct binding through signed halt.
- `test/cloud.test.ts` — 37 cases
  - Private persistent state and explicit Key Vault model keys.
  - Refusal of `imessage`, `signal`, `whatsapp`, `mcp`, and `unknown` bindings
    (five cases).
  - Required A2A receiver and missing binding.
  - Bounded A2A and probes, preserved authorization bytes, and suppressed
    provider errors.
  - Signed message admission on `/a2a` (compact) and `/answerable` (compact
    and document) (three cases).
  - Empty 503 on decision commit failure on both routes (two cases).
  - Direct HTTP route, media types, and byte limit before the gate call.
  - HTTP 200 for admission and refusal at the A2A byte limit with the default
    and explicit receivers (two cases).
  - Closing unfinished oversized chunked uploads on both routes at 415, 413,
    and the two 417 cases per route (eight cases).
  - Replying and freeing the slot when final bytes arrive with EOF for
    fixed-length and chunked uploads on both routes (four cases).
  - Replying after the client half-closes on both routes (two cases).
  - Shared upload slots and reclamation on disconnect.
  - Listener abort, daemon drain, and credential close order.
  - Composition close on daemon and listener startup failures.
  - Retaining the file lease through inbound cancellation and drain.
  - Releasing startup leases after factory failure or cancellation.
  - Synchronous receiver failures and response size bounds.
  - Shared in-flight limit for pipelined requests.

## Daemon speed (40v)

<!-- AUTHORED-BY Codex GPT-6 -->

The Node 24 CPU profile for the two recall tests on `171175102` attributed
about 1.15 seconds to state reads and 0.88 seconds to saves. Rebuilding and
parsing the canonical graph took about 0.51 seconds within reads. Per-entry
verification took about 0.49 seconds within saves. N3 lookups and named-value
decoding were prominent. Assembling and hashing the contents header took
about 10 ms in the same profile.

A cold load still decodes the RDF and rebuilds the canonical representation.
When that representation matches the file, the one parse and byte comparison
verify both the graph and its contents digest. Files with a different RDF
layout still go through graph comparison, including the legacy Agreement
timestamp handling. Repeat loads of a cached snapshot reread the bounded
file with fatal UTF-8 decoding, match the header, and hash the body before
returning a fresh copy of the state.

The first save after a canonical load reuses entry encodings by their JSON
text. Save verification parses the outgoing blocks, checks their canonical
bytes, and reuses verification for unchanged blocks. It also uses the same
entry quads for decoding, byte comparison, and checking cross-entry links.
The writer serializes staged entry quads directly. Named-value reads check
each list position once and compute value IDs only for collections and nulls.
Writer-assigned IDs and per-entry reference limits still apply. Tests cover
same-length corruption after a cached read and verify that changing one entry
after reopening encodes only that entry.

### Local timings

Daemon timings are median Vitest test-body times from three Node 24.22.3
runs with file parallelism disabled. Main is `ff5581b55`, including its
versions of `fetch-rdf` and `solid-odrl`. Before is `171175102`. The 50-save runs
used the populated state fixture, changed one nested value each save, and
added 25 entries. Each save benchmark reports the median of four runs.
The corpus row is one filtered Vitest test per revision with
`AWP_STORE_RDF=1` set by the test.

| Workload | Main locally | Before | After | After / main |
| --- | ---: | ---: | ---: | ---: |
| Recheck a released proposal after installing a deny-all mandate | 1,042 ms | 1,472 ms | 1,236 ms | 1.19× |
| Recall refused successor across restart | 711 ms | 1,600 ms | 1,074 ms | 1.51× |
| Recall refused successor revision across restart | 470 ms | 1,420 ms | 980 ms | 2.08× |
| 50 durable saves | | 504 ms | 401 ms | |
| 50 RDF-verified memory saves | | 291 ms | 255 ms | |
| State corpus `cohort-count/baseline` | | 92.48 s | 72.59 s | |

The revision recall case took 813 ms on main, 1,857 ms before, and
1,464 ms after when run by itself. These are also medians of three runs.
The isolated case is 1.80× main. It is 2.08× when it follows the other
recall test in the combined run.

### Verification

The library compile and generated-file copy passed. The trace check passed
across five scenario paths, with 278 manifest runs, zero disagreements, and
five blocked paths. All 101 tests passed across the six store, ledger,
named-value, capability, and state RDF files. The RDF pipeline check passed
with 216 existing allowances. The populated v2 fixture encoded byte for byte
as it did on `171175102` and decoded to the same state.

Daemon typecheck passed. The full daemon run passed 297 of 339 tests,
including the three performance cases at their existing timeouts. These 39
cases could not listen on `127.0.0.1` in the sandbox and reported
`listen EPERM`.

- `demos/d2-spending-limits.test.ts` — hostile email and A2A proposals with
  executor-gated transfers and cumulative spending.
- `test/css.test.ts` — the in-memory CSS pod and direct binding through signed
  halt.
- `test/cloud.test.ts` — 37 cases
  - Private persistent state and explicit Key Vault model keys.
  - Refusal of `imessage`, `signal`, `whatsapp`, `mcp`, and `unknown` bindings.
  - Required A2A receiver and binding.
  - Bounded A2A and probes, preserved authorization bytes, and suppressed
    provider errors.
  - Signed admission on `/a2a` with compact input and on `/answerable` with
    compact and document input.
  - Empty 503 for decision commit failures on both routes.
  - Direct HTTP route, media types, and request byte bound before the gate.
  - HTTP 200 for admission and refusal at the A2A byte limit with the default
    and explicit receivers.
  - Closing unfinished oversized chunked uploads on both routes at 415,
    413, and in both 417 cases per route.
  - Reply and slot release when final bytes and EOF arrive together on both
    routes with fixed-length and chunked bodies.
  - Reply after the client half-closes on either route.
  - Shared slots for unfinished uploads and reclamation on disconnect.
  - Listener abort, daemon drain, and credential close order.
  - Composition close on daemon and listener startup failures.
  - File lease retention through inbound cancellation and drain.
  - Startup lease release after factory failure or cancellation.
  - Synchronous receiver failures and response size bounds.
  - Shared in-flight limit for pipelined requests.

Three other cases passed on rerun with subprocess output captured in regular
temporary files. They cover packaged CLI help and JSON/CSV exports, launchd
plist validation, and production dependency packaging.

## Phase 4 (40w)

<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

Step 1 is complete on `34befa945`. The two hand runs produced four traces.
The committed engine traces, outlines and run manifest, and the explorer's
existing traces and data were restored from HEAD. The explorer includes four
new context documents. The orchestrator runs steps 2–4.

### Trace and inspector

The trace writers opt in to the `linked` table. Library and oracle runs use the
original format by default. The runtime captures store graphs at the event
site. The recorder uses the existing store projection and writes JSON-LD and
Turtle during completion. It serialises each distinct graph once and keeps the
event's references in display order. Each table key is the SHA-256 of the exact
JSON-LD text. The runtime trace schema checks that every event reference exists.
The exported JSON Schema describes the key and value shapes. Checking a dynamic
key against another part of the document is done by the runtime schema.

The gate decision view uses the actual sealed entry. A verified record summary
points to a relevant entry, such as the last eligible entry for a chain check
or the grant entry for a mandate display. An empty record has no entry to show.
The provider's settlement event uses its own settlement view. The early
authorization-server grant-lift event precedes the runtime's ledger append and
keeps its existing fact display. The sampled traces contain no recall events.
The runtime uses the same held-fact lookup for a recall as for a store event.

The policy and register fixtures include identifiers with a second `#`. The
suite's JSON-LD reader drops those RDF terms. The view projection escapes the
extra fragment delimiter in both formats and keeps distinct identifiers
distinct if the escaped name is already used. The sealed records, policies and
wire identifiers keep their original spelling. The existing vocabulary,
context pins and generated models supply the terms for these views.

The explorer shows highlighted JSON-LD and Turtle or TriG together. The context
fold state follows the reader between events. Bundled contexts open in the same
wide dialog. The old inspector summaries still work with traces that have no
linked table. The existing inspector test now checks both packet panes and the
context fold in place of the old format toggle. The engine's existing trace,
caption and oracle assertions were kept.

### Verification

Node 24 was first on PATH. The age run used the offline
`sparq-org-zk-result-0.1.8.tgz` with SHA-256
`42a52776b3046efab999d8555ea9e815175f1b2ac0dce3f2832e8905748410e0`.
The archive was extracted to a temporary directory and supplied through
`ANSWERABLE_SPARQ_ZK_RESULT`. The older archive lacked the required
`testIssue` export.

| Command from the reference package unless indicated | Result |
| --- | --- |
| `npx tsc -p tsconfig.build.json && node scripts/copy-generated.mjs` | Compile and generated-file copy passed. |
| `npx vitest run test/trace-linked.test.ts test/trace-schema.test.ts test/traces.test.ts test/labels.test.ts test/oracle-snapshot.test.ts test/runtime-packets.test.ts test/record-rdf.test.ts` | 48 tests passed. Includes the identifier-free caption check and byte comparisons for age main, age branch, mortgage baseline and mortgage data integrity. |
| `npx vitest run test/oracle.test.ts test/recorded-joint.test.ts` | Five passed. The oracle ran with SHA-verified joint recordings. The oracle fixture's SHA-256 is `4f63d12f5e58b1d4a2f085c3d524b671663a1d96dd61c45ee875838d1308922f`. |
| `node scripts/check-no-trace-change.mjs` | Passed. Its disposable runs of mortgage-core and pay-an-invoice preserved the five traces, outlines and manifest rows. The check uses `--no-linked`. |
| `node scripts/run-scenarios.mjs --scenario=age-check` and `node scripts/run-scenarios.mjs --scenario=mortgage-core` | Two live paths each. Both reported 278 runs, zero disagreements and five blocked. Recorded outlines were byte-identical. |
| `node scripts/export-schemas.mjs --check` and `npx tsc -p tsconfig.json --noEmit` | Schema export and typecheck passed. |
| `node scripts/check-rdf-pipeline.mjs` and `npx biome check src test scripts eval/e0/run.mjs eval/e0/vitest.config.ts --diagnostic-level=error` | Zero RDF failures, with 216 existing allowances. Biome found zero errors. The explorer component and its new test passed Biome too. |
| `node scripts/bundle-data.mjs` and `node --test --test-isolation=none test/*.test.mjs` in the explorer | The bundle indexed 278 traces and copied all four contexts byte for byte. Its largest trace was 3,483,992 bytes against the 12,000,000-byte limit. All 53 tests passed with the four new sample copies and with the committed traces restored. |

`test/trace-linked.test.ts` runs each switch setting in a fresh process with
the recorded generation commit. With the switch off, the entire UTF-8 trace
matches the committed file. With it on, removing the table and event references
gives exactly the same bytes, including packet JSON-LD, packet RDF, attachment
digests, outlines, captions, rule texts and chat lines. The same test expands
every view with the offline context loader and compares it to its Turtle
quad for quad. It checks all four view categories and rejects any gate-check
entry attached as a record view.

A fresh age proof is randomised. To compare the same inputs, the test replays
the committed prover output at the prover boundary and runs the real receiver
verification. Replaying through the proof cache would change the caption to
describe an earlier proof. The hand run generates a fresh proof as usual.

The six recorded joint engine traces matched the SHA-256 values in the
manifest. The scenario writer retains those baseline recordings whether or
not the optional aggregate adapter is installed. The final
`git diff --exit-code` on engine traces, outlines, the run manifest and the
oracle fixture, and on explorer traces and tracked data, returned zero.
`git checkout` could not take the index lock in this worktree. The changed
artifacts were restored from `git show HEAD:<path>` and checked again. The
restored manifest has 283 paths and SHA-256
`7b490268f90bd3c0541322fc27e4902531383aa1abdcf0b54ca50a63f2e78f53`.

### Speed and trace size

`node scripts/profile-journey.mjs --iterations=3 --main-only` ran with the
library default. The baseline median went from 8,688 ms to 7,800 ms. The
data-integrity median went from 8,831 ms to 8,259 ms. The recorder performs no
linked RDF work in either default run.

Explorer `traces/` is 164,576,968 bytes after restoration. Applying the
existing explorer copy rules to the four hand-run traces increased their
combined size from 991,754 to 2,725,137 bytes. With just those samples replaced,
the directory was 166,310,351 bytes. Scaling the measured increase to the
other live traces while holding the six recordings fixed gives an estimate of
429 MB after regeneration. The sample is small and each journey adds a different
mix of store views. The full bundle step will measure the actual size.

The browser layout still needs a visual check at 360, 700 and 1280 pixels.
Open an inspector view with long lines, scroll each pane with the keyboard,
toggle the context, move to another event and open the wide dialog. Check that
Escape and Close restore focus to the opener.

## Shared tables (40x)

<!-- AUTHORED-BY Codex GPT-6 -->

Both corpus writers now put a scenario's linked views in `traces/linked/<scenario>.json`.
The trace keeps `linkedTable` and the event key lists. Keys are still SHA-256
digests of the JSON-LD text. The runtime schema validates inline tables and
uses a caller-supplied lookup for shared tables. The corpus test checks every
trace reference, table digest, and unused key. The writer sorts the keys and
keeps the entries still used when a run replaces just one configuration.

Each view keeps JSON-LD and Turtle. JSON-LD uses the bundled store and, when
needed, ODRL context IRIs. The legacy generator exposed a protected-term
conflict when it combined the credential and store contexts. The store
context supplies its existing credential aliases, and other credential
terms keep their full IRIs. The RDF round-trip test covers that case.

| Hand-run file | Engine bytes before | Engine bytes with shared tables |
| --- | ---: | ---: |
| `age-check--baseline.json` | 281,049 | 283,737 |
| `age-check--branch-1--baseline.json` | 80,773 | 81,889 |
| `mortgage-core--baseline.json` | 783,379 | 790,471 |
| `mortgage-core--authenticity-data-integrity.json` | 574,061 | 581,153 |
| `linked/age-check.json` (31 keys) | — | 403,438 |
| `linked/mortgage-core.json` (67 keys) | — | 819,497 |

The two mortgage traces reference 43 keys each and share 19. The engine
directory starts at 678,116,725 bytes, including its index. The four samples
and two tables add 1,240,923 bytes. Applying the sample's average trace
increase to 272 live traces and its average table size to 72 scenarios gives
about **723 MB** for the engine and **209 MB** for the explorer. The six
joint recordings are held fixed. Both estimates use decimal MB and two
scenarios, so the size depends on the mix of views in the full corpus.

Both `run-scenarios.mjs` hand runs produced two paths and reported 278 runs,
zero disagreements, and five blocked paths. The live age run used
`ANSWERABLE_SPARQ_ZK_RESULT` with the extracted offline 0.1.8 package from
40w. The byte comparison replays the recorded prover output at the boundary
so it compares the same inputs. With linked views off, the four traces match
the committed bytes. With views on, stripping the table reference and event
keys gives the same bytes. The linked table's keys resolve and cover all
entries. Repeating just the mortgage baseline configuration left both table
hashes and both mortgage trace files byte-identical.

`check-no-trace-change.mjs` passed with the mortgage table present and after
restoration. All six joint traces matched their recorded SHA-256 digests.
The tracked outlines and run manifest matched HEAD. The worktree's Git index
is read-only, so `git checkout` could not take its lock. Changed tracked
artifacts were restored from `git show HEAD:<path>` and the two temporary
tables were removed. The final artifact diff was empty.

On Node 24, the library compile and generated-file copy, schema export
check, and typecheck passed. The seven requested Vitest files passed all 50
tests. Vitest used a temporary `.sparq` symlink to resolve the same offline
package at its literal import path. Biome and the agent layer guard passed.
The RDF pipeline reported zero failures and 216 existing allowances.
`generate-traces.mjs` also wrote all five reference traces with their tables
in a disposable directory.

## Review 40r10 fixes

<!-- AUTHORED-BY Codex GPT-6 -->

The projection escapes percent signs and additional fragment delimiters in
every IRI fragment. Separate views rooted at `#entry#two` and `#entry%23two`
produce distinct RDF identifiers and recorder keys. JSON-LD carries each
`rdf:JSON` value as a typed string with the stored lexical form. The
quad-for-quad test covers nested key order and unpaired surrogates.

The grant-lift event links the sealed grant entry returned by the runtime
append. The provider settlement event links the transfer selected by the
receipt's ledger reference. The payment test reconstructs the transfer from
its RDF view and verifies the digest against the receipt. The grant test
compares the event's sequence, caption and fact with the committed trace.

The scenario runner replaces matching manifest rows in place. The manifest
matches `origin/main` byte for byte. Disposable hand runs of `age-check`,
`mortgage-core` and the mortgage baseline configuration each kept those
manifest bytes. The no-trace-change guard now compares the rows in order
and passed for all five paths in its two scenarios with and without the
sample shared tables.

The Node 24 library compile, schema check, typecheck and Biome error check
passed. All 75 focused engine tests passed, including the linked-switch byte
comparisons and the six joint-recording digest checks. All 57 explorer tests
passed on the committed corpus and again with four hand-run traces and their
shared tables in a disposable copy. The bundle copied both sample tables
byte for byte. The tracked traces and outlines match their original bytes.

Fresh-process checks also matched the committed trace bytes for the grant
and payment runs after removing the linked fields. Repeating `pay-an-invoice`
in one process varies three existing packets. The same variation reproduced
on the starting commit `e3796a576` with linked views off. The linked run's
stripped bytes matched the corresponding repeated switch-off run exactly.

## Review 40r11 fixes

<!-- AUTHORED-BY Codex GPT-6 -->

The runner stages and publishes one table per manifest scenario and
configuration, with `baseline` as the default suffix. Branches in that group
share the file. Publishing takes an exclusive lock through the table and
trace replacements, retains keys still used by branches outside the write,
and prunes superseded keys. The README describes recovery from a stale lock.

The schema rejects invalid paths before invoking a table resolver. The writer
and corpus check require regular files and directories inside the canonical
`traces/` directory. The corpus check verifies the expected group, content
digests and exact set of referenced keys. JSON-LD, Turtle and TriG use the
same canonical quad order. The regression test compares bytes from two
insertion orders and reads both RDF renderings back into quads.

The representative runs exposed a linked-view failure in `flat-share`.
Scenario own-list entries can carry purposes for identity pins. The view now
projects the fields used by recipient trust, with a regression test for an
own-list entry that also carries a pin purpose.

The isolated `mortgage-main` run covered all 38 configuration groups and
113 live paths. Its largest table was
`linked/mortgage-main--accountability-reputation-post.json`, with 417 keys
and **4,172,563 engine bytes**. The compact explorer copy was **4,157,963
bytes**, about 35% of its limit. The 38 tables totalled 95,827,452 bytes
in the engine and 95,514,367 bytes in compact form.

The projected full trace directories are **809 MB for the engine** and
**294 MB for the explorer**. The estimate uses those 38 measured table
sizes and extrapolates from 12 other groups. It weights those groups by
whether their existing engine traces total at least 1 MB, includes event
keys and table references, and holds the six joint recordings at their
original sizes. All sizes use decimal MB.

The Node 24 library compile, schema export check, typecheck and Biome error
check passed. The focused and compatibility suites passed 97 tests across
11 files. The corpus check also passed with all 50 measured tables in a
disposable copy. `check-no-trace-change.mjs` passed on the committed fixtures
and with the mortgage-core and pay-an-invoice group tables present. All six joint
recording digests verified. The worktree's traces, outlines and run manifest
matched HEAD after the runs.

## Review 40r12 fixes

<!-- AUTHORED-BY Codex GPT-6 -->

The public bundle checker decodes nested RDF and JSON strings until they stop
changing or reach eight decoding levels. It scans parsed JSON string values and
the unescaped text. Regression fixtures put roadmap text with quotes and a
newline in an `rdf:JSON` literal, in standalone JSON-LD and Turtle and in both
linked table renderings.

Scenario runs use the table writer's exclusive file lock for the manifest and
trace index. Publication rereads the manifest under the lock, replaces rows in
place, and replaces each file atomically. A regression test starts two processes
for different configurations from the same manifest snapshot and verifies that
both rows and both index entries survive. When a path becomes blocked, the
publisher removes its old trace and index entry and prunes the group table to
the keys still referenced. The regression also covers removal of the last
trace and table in a group. The corpus check rejects any trace file that the
manifest does not name.

On Node 24, all 50 focused engine tests and all 60 explorer tests passed. The
library compile, schema export check, typecheck, Biome, and disposable
`check-no-trace-change.mjs` runs passed. The RDF pipeline reported zero failures
and 216 existing allowances. The agent layer guard reported two existing
nonliteral imports in `test/trace-linked.test.ts`. The tracked traces, outlines
and run manifest match HEAD, and no linked test files remain in the worktree.
