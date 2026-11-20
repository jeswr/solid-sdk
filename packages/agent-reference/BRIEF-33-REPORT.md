<!-- AUTHORED-BY Codex GPT-6 -->
# Brief 33 — Solid reference access and access control

Sam’s agent keeps the exact bank-signed balance statement in the fictional evidence pod. The approved disclosure binds the requested address, reader and duration. At release the gate applies a conditional WAC update, verifies Read access, and substitutes a signed pointer for the balance statement. Income remains in the delivery. The lender checks the pointer at delivery, reports the pending statement, then checks the fetched statement and stores a purpose-bound copy through its deletion date. Withdrawal removes the original rule through the ordinary effect gate.

The access-control configuration inherits this world. It checks a proposed translation against the supplier policy, the agreement and the matched mandate before any ACL write. The ACL and pointer name the supplier’s share permission and the agreement’s read permission. Purpose, onward sharing, storage, derivation, aggregation and duties remain in the signed terms.

| Configuration | Path | Measured verdict | Added exchanges |
|---|---|---|---:|
| By reference on Solid | `main` | Disclosure and data terms pass. The lender admits both delivery and read. The final application receipt equals the baseline’s. | 1 |
| By reference on Solid | `grant-wider-than-terms` | `disclosure` / `excessive-scope` → `stop` | 0 |
| By reference on Solid | `read-after-withdrawal` | Withdrawal goes. The pod returns 403. `source` / `not-authorised` → `refuse`. The lender retains its permitted copy. | 1 |
| Solid access control | `main` | Data terms approves the translation. The lender admits the read and its policy provenance. The final application receipt equals the reference run’s. | 1 |
| Solid access control | `translation-grants-more` | Disclosure passes. `data-terms` / `prohibited` → `stop`. | 0 |

All five rows moved from blocked to runs. The manifest changed from **251 runs, 18 disagreements, 14 blocked** to **256 runs, 18 disagreements, 9 blocked**, with **283 paths** both times. Every other row retains its previous content. Both main paths pass C1–C5 using the unchanged comparisons. The usage-control comparison uses the by-reference main run as its reference. The five traces and outlines are published, and their caption, rule, chat, resolution and stand-in prose contains no raw IRIs. Existing outlines, local-holder traces and the 164-path oracle file are byte-identical to the starting revision.

## Design calls

- The fictional provider enforces resource-specific WAC. Its signed receipt records HTTP carriage. The bank’s signature supplies source evidence. The fixture introduces actor keys to the stand-in in place of Solid-OIDC. The provider sees each read and can read the stored balance statement.
- ODRL translation is specific to this evidence disclosure. A supplier permission that lets the current holder use the balance does not itself authorize transfer to a new reader. The supplier’s share permission and the agreement’s read permission establish the exported links. The matched local mandate limits the grant and stays in Sam’s signed record.
- The pod-access SDK’s `translatePolicy` and `assertNotWider` operate on normalized effective storage policies. They take storage subjects and modes as inputs, so using them here would first require a separate mapping for the signed supplier terms, agreement, time bound and permission provenance. The gate checks that mapping directly. No dependency was added.
- The second intake receipt uses the existing agreement conversation. The new pending count is a declared numeric field on the Solid configuration’s profile. Both configurations keep `replaces` empty.
- D2, D6, D7 and D8 remain pending maintainer decisions.
- The release transaction restores the original ACL bytes when its grant was the only intervening update. When the pod is unavailable during compensation, the sender records the unresolved withdrawal and withholds the pointer. The tested provider outage occurred before the ACL update.
- The agreement allows 60 days of copying. The gate limits the pod lease to whole days that end strictly before Sam’s signed mandate expires, giving this lease 59 days. The 60-day lease would have ended two minutes after the mandate. The approved access parameters bind the shorter lease, and expiry uses the same gated effect as principal withdrawal.

## Verification

The restart interrupted the all-scenario build and full package Vitest invocation. The orchestrator owns the full gate under the resume instruction.

- TypeScript build, generated-file copy, schema drift check, typecheck, lint and targeted scenario regeneration passed.
- Both main paths passed the unchanged C1–C5 comparisons.
- Seven focused Vitest files passed 33 tests, including the grant transaction, rollback, withdrawal, expiry, translation, registry and trace checks.
- The RDF pipeline reported **0 failures and 213 allowances**.
- The artifact audit verified all 283 manifest row keys, the five status changes, the new trace and outline files, and the preserved local-holder traces. The 164-path oracle file matches the starting revision.
- Removing each of the three decisive checks made its focused test fail with the expected verdict missing. All three files were restored after the isolated runs. The engine report records each mutation and result.
- The live oracle matched all 164 baseline paths after the repository installer verified and loaded the pinned local SPARQ aggregate archive. The first run reached 158 paths while that optional adapter was absent.
- Final regeneration reproduced all five trace files byte-for-byte. The workspace agent-layer check and `git diff --check` passed.

## Review fixes

| Finding | Fix | Regression | Changed paths |
|---|---|---|---|
| High — unchecked WAC selectors | The gate accepts only the declared translation fields. The ACL writer builds a resource-specific Read rule from the checked pointer and its verified policy links. | The translation test rejects extra public, authenticated, default and group selectors. | `src/mechanisms/access-translation.ts`, `src/gates/outbound.ts`, `src/standins/pod-access.ts`, `test/solid-access-control.test.ts` |
| High — inconsistent retention inputs | The gate binds the terms digest to the conversation's current offer or agreement and bounds the actual lease by the agreed copy deadline. It checks the lease's authorization period and the copy's retention against the supplier's signed terms. | The core reports one day while the proposed lease is 59 days and the copy is due after 60 days. A supplier limit of 30 days blocks both and a limit of 59 days blocks the copy. | `src/gates/outbound.ts`, `src/gates/quality.ts`, `src/runtime/agent.ts`, `test/solid-by-reference.test.ts` |
| High — orphaned grants after an uncertain PUT | The runtime persists the fragment and cleanup details before the ACL PUT. Recovery and duty processing retry unresolved removals. The cleanup confirms the fragment is absent and uses the current ACL validator, preserving concurrent changes. | The pod commits the PUT, loses the response and stays unavailable through rollback. The test observes the write-ahead snapshot and verifies that recovery removes the grant while preserving a separately added rule. | `src/runtime/agent.ts`, `src/store/state.ts`, `src/standins/pod-access.ts`, `src/model/solid-storage.ts`, `test/solid-by-reference.test.ts` |
| High — late expiry after the mandate ends | The outbound effect accepts authority from the original grant for removal of that exact ACL fragment once the lease is due. Attempted removals can be reconciled by the same idempotent operation. | Two cases discharge the duty after the original mandate expires or is revoked and confirm that the pod then returns 403. | `src/runtime/agent.ts`, `src/gates/outbound.ts`, `src/standins/pod-access.ts`, `test/solid-by-reference.test.ts` |
| Medium — premature delivery record and go | The Solid release records its intent for the final readiness check, then records and emits the delivery after readiness succeeds. A failed release records the abort and compensates the ACL write. | A failed readiness check after the PUT leaves no delivery record or delivery go and removes the reader rule. | `src/runtime/agent.ts`, `test/solid-by-reference.test.ts` |
| Medium — reference payloads survive `deleteBy` | A durable deletion duty covers the gate statement and the matching purpose-store revision. Deadline processing erases both payloads and retains audit metadata. | Both payloads exist before the deadline. After discharge, the gate statement is gone and the store holds a tombstone for the copy. | `src/runtime/agent.ts`, `src/runtime/duties.ts`, `src/runtime/operations.ts`, `src/domains/mortgage.ts`, `src/domains/purpose-store.ts`, `test/solid-by-reference.test.ts` |
| Medium — malformed statement admitted | The inbound gate checks the verified statement against the operation's evidence schema at fitness, before admission and retention. | A correctly signed deposit statement with a string balance passes integrity, source, authority and terms, then fails fitness with `evidence-invalid` before retention. | `src/gates/inbound.ts`, `src/runtime/agent.ts`, `src/runtime/operations.ts`, `src/domains/mortgage.ts`, `test/solid-by-reference.test.ts` |

### Regenerated artifacts

The two targeted configuration runs reproduced five running paths. Three traces show
the new sender release-intent and receiver deletion-duty records in their ledger counts.

- `traces/mortgage-main--data-access-by-reference-solid.json`
- `traces/mortgage-main--read-after-withdrawal--data-access-by-reference-solid.json`
- `traces/mortgage-main--usage-control-solid-access-control.json`

The manifest and trace index rows were byte-identical after preserving their original
order. The other two traces and all outlines matched their original bytes.

### Verification after review

- All nine regression cases failed on an isolated copy of `d726fb751` and passed with the fixes. The final erasure test also verified that the saved runtime snapshot held only a tombstone.
- Seven focused Vitest files passed 36 tests under Node 24 with `--maxWorkers=2`. The live oracle matched all 164 baseline paths and its committed snapshot was byte-identical.
- Both Solid main paths passed C1–C5. Repeating the targeted scenario runs reproduced the three updated traces byte-for-byte.
- The TypeScript build, generated-file copy, schema check, typecheck, Biome, agent-layer guard and RDF pipeline passed. The RDF pipeline reported zero new failures.

## Review fixes, round 2

<!-- AUTHORED-BY Codex GPT-6 -->

| Finding | Fix | Regression |
|---|---|---|
| 2. Reader restrictions across the lease | The gate checks `read` and applicable `use` prohibitions for the reader's actor and represented party at every time boundary inside the end-exclusive lease. Solid access-control translation validates the supplier policy and the agreement against the proposed rule's actual interval. | Both release configurations refuse a supplier prohibition that applies for a single instant mid-lease. Translation also rejects an agreement prohibition that starts mid-lease and accepts a lease ending at that boundary. |
| 3. Uncertain ACL PUT still in flight | The journal saves the original `If-Match` validator. When the rule is absent and that validator is still current, cleanup conditionally writes the same ACL bytes to advance its revision. The stand-in assigns a fresh validator even when the bytes repeat. Cleanup retains the journal until it can establish that the grant is absent and the original PUT can no longer commit. | A delayed PUT outlives a failed cleanup attempt. Recovery preserves the ACL bytes, clears the journal after advancing the validator, and the delayed PUT returns 412. |
| 4. Due withdrawal retries | A stop before execution leaves a valid expiry withdrawal planned under the authority of its original grant. Recovery revalidates the exact duty, effect parameters and intent before retrying. | With the mandate revoked, the first gate refusal leaves the duty pending and the ACL alone. Recovery retries the planned effect, discharges the duty and the pod returns 403. |
| 5. Delivery decision before outbox commit | The release records the actual `message-out` and emits `go` after the snapshot commits the outbox entry and expiry duties. The ACL cleanup journal already exists at the commit boundary. | A fault injected at the snapshot save observes a durable cleanup journal and no delivery decision or delivery record. Recovery removes the ACL rule. |
| 6. Deletion tied to the retained grant | Each admitted read saves its gate statement and the deletion duty for that item and grant in the same snapshot, before the operation stores its copy. The runtime refuses a reference read if the operation has no erasure hook. Deadline processing uses the duty's grant after the current pointer changes. | Replacing the pointer for a retained statement leaves the older grant's deletion deadline in force for both payloads. An operation without an erasure hook admits neither payload. |
| Final independent record flush | The release stages the confirmed grant, signed delivery seal and transfer records, then requires the independent flush before inserting the outbox entry. A failed flush aborts the release and rolls back the grant. | The final flush observes the grant and seal before any outbox save. Making that flush fail leaves no delivery and removes the reader rule. |

The reference agent has no legacy deployments. The withdrawal change keeps current
effects retryable before execution, and the erasure change relies on duties created at
current admission. Round 2 removes the pointer-based backfill and adds no migration
for historical effects or retained copies.

Both Solid main paths passed C1–C5. Targeted regeneration ran all five paths and
updated three traces, each with one additional ledger entry for the delivery seal.
The other two traces, all outlines, the trace index and the scenario manifest matched
their previous bytes. The live oracle matched all 164 paths against the byte-identical
baseline. Seven focused Vitest files passed 61 tests under Node 24 with `--maxWorkers=2`.
The TypeScript build and typecheck, schema check, Biome, agent-layer guard
and RDF pipeline passed. The RDF pipeline reported 0 failures and 213 allowances.
