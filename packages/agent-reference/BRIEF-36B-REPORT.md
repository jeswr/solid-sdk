<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 36b review fixes

## Review findings

| Finding | Change | Regression |
| --- | --- | --- |
| 1. Publication | The adapter destination and action still bind to the proposed parameters. The fact digest now covers the full verified signed payload, including fields the claim schema would strip. | `email.test.ts` changes an unadmitted field inside a signed period while preserving the admitted fields. It also checks a substituted claim, a redirected host and the valid publication. |
| 2. Range disclosure | The manifest inventories the exact signed representation, offer and acceptance bytes. Each companion proof needs a grant from its authenticated owner for the releasing agent, recipient, purpose and digest. The gate checks those items alongside the fee credential and any credentials embedded in the agreement. A record adapter requires a distribution action on both execution and retry. | `regulator-claim-alternative.test.ts` checks the three companion proof terms and separately withholds permission for the acceptance and representation. `email.test.ts` exercises a record effect proposed as `use`. |
| 3. Item prohibition | The shared mandate evaluator still checks the item and release targets. | `principal-use.test.ts` covers the prohibition with and without approval. |
| 4. Unrelated fee agreement | The forum still binds the fee notice to the agreed offer, acceptance, participants, conversation and terms digest. | `forum-range.test.ts` exercises the valid, unrelated and reversed-notice cases. |
| 5. Stale register answers | The register resolver still uses the latest admitted answer and its fixed expiry. | `register-freshness.test.ts` checks expiry, suspension and the interval after the suspension expires. |
| 6. Reserved branch name | The scenario validator still reserves `main`. The runtime and writer use the explicit path kind. | `gate-fault-guards.test.ts` checks a vendor-fault branch named `main`. |
| 7. Mailbox challenge binding | Delivery completion still activates the generated nonce for the named mailbox and purpose. Activation and consumption now survive restart. | `email.test.ts` checks pre-delivery rejection, activation, scope and replay. |
| 8. Record-backed claims | A claim must point to a runtime-authored audit. The claimed points must resolve to the same actor's authorisation decision and immediately corresponding outbound gate release, with the claimed action and mandate digests. The audit ignores core-authored rows. | `email.test.ts` checks a valid chain and rejects a core-authored audit or an audit that cites a false chain point. `vendor-fault-alternative.test.ts` exercises the valid fault and attempts with a different digest, operator or range. |
| 9. DID confinement | C3 validates the alias map against the reference world's declared identities and rejects collisions, aliases for policy identifiers and aliases outside the DID suite. The runner repeats validation on the effective branch world before applying it. | `configuration-extends.test.ts` checks the registered DID configuration and rejects operation and trust-root aliases and a DID shared by different parties. |
| 10. Mixed prerequisites | A prerequisite still cannot itself require or extend another configuration. | `configuration-extends.test.ts` covers the mixed chain. |
| 11. C2 binding | Gate decisions bind the message payload digest. C2 also checks the outbound action digest and requires each resumed passing check to follow the same-digest approval. | `confinement.test.ts` substitutes a payload under the same message ID and gate run and moves a resumed passing check before approval. |
| 12. Scoped stops and branch order | A narrower proposal preserves its target, recipient, purpose and the digest of all parameters apart from the evidence list. It must disclose a strict evidence subset. Ordered comparison detects a branch that ends after an identical prefix. | `branch-comparison.test.ts` checks a broader retention binding, a valid narrower proposal and a missing decision. The selective-disclosure scenario proposes the same agreement parameters in both actions. |
| 13. Whole-record completeness | Both parties' records require peer-signed terminal commitments scoped to the conversation and interval. Whole records prove genesis through that endpoint. The forum checks the respondent's witness before requesting an answer. | `forum.test.ts` rejects missing claimant and respondent commitments and a truncated whole record. `forum-range.test.ts` checks witnessed whole and ranged records. |
| 14. Historical approval key | The audit treats an unavailable verification key as indeterminate. The runtime reports an outside finding only when the release can be judged outside the mandate. | `email.test.ts` releases under a secondary owner key, restarts with the mandate key alone and checks the resulting indeterminate audit. |

## New defects

| Defect | Change | Regression |
| --- | --- | --- |
| Approval notes in whole records | The signed approval stays in private runtime state, indexed by the proof digest committed to the ledger. Older committed rows carrying the original JWS are redacted during export. An older row without a redaction commitment blocks export. | `email.test.ts` checks the exact decoded whole-record entries and their entry proofs for the absence of the approval JWS. |
| Unrelated invokes in ranges | The exporter keeps message metadata only for messages whose matching signed archive proof it exports. It emits a chain commitment for the other rows. The release checks both directions of the entry-to-proof correspondence. | `email.test.ts` adds an unrelated invoke and verifies that the signed range retains its commitment while omitting its row and proof. |
| File-ledger crash recovery | Startup verifies the retained suffix from the state checkpoint and verifies the retained chain at the new head. It saves the recovered head through the normal durable state store. The ledger also fsyncs the directory when creating a segment file. | `email.test.ts` simulates a crash between ledger append and state checkpoint and verifies the recovered durable head. A second test changes a suffix row and checks that the runtime refuses the head. |
| Mailbox challenge restart | A pending nonce is stored on the effect. The durable conclusion records activation after confirmed delivery, including reconciliation. The inbound reply commits consumption with admission. | `email.test.ts` restarts before approval, after a lost delivery response, after reconciliation and after consumption. |

## Gate fixes

- The RDF parameter readers and publication recipient callback now use the named-value RDF model. The pipeline guard reports 0 failures and 213 allowances.
- A regulated-role term checks the role ID against an authorized, current register entry. Where the resolver reads a register through signed answers, it uses the latest admitted answer. The mortgage fixtures give the lender role explicitly to North Bank and Harbour Bank. The valuer's ordinary operation grant still resolves for operation routing. The pinned-list suite uses a previously accepted register entry with a fixed expiry and needs no live register lookup. `trust-pinned-mortgage.test.ts` checks both the offline mortgage and the missing or expired registration cases. `later-bars.test.ts` locates the balance-copy gate run and checks disclosure pass followed by a data-terms stop with no approval or transmission. `register-freshness.test.ts` checks that an own-list entry for the role itself cannot substitute for registration.
- The same role/operation confusion affected payment item terms, general distribution item terms and its follow-up, structured payload terms, and free-text context terms in the outbound message gate. All use the registered-role check. The plain-email terms path lacked a role resolver. It now checks the role and blocks a verbatim release of a restricted item when registration is missing. The ordinary recipient routing check continues to use operation permissions.

## Changed source and fixture paths

Paths are relative to this package.

| Paths | Reason |
| --- | --- |
| `src/runtime/agent.ts`, `src/runtime/operations.ts` | Exact effect bindings, archive and disclosure manifests, approval audit, record-backed claims and mailbox lifecycle. |
| `src/store/ledger.ts`, `src/store/state.ts`, `src/mechanisms/record-audit.ts`, `src/mechanisms/forum.ts` | Durable fields, recovery, audit provenance and peer-witnessed completeness. |
| `src/gates/inbound.ts`, `src/gates/outbound.ts`, `src/trace/types.ts` | Gate binding digests, disclosure enforcement and role-specific recipient checks. |
| `src/engine/compare.ts`, `src/engine/confinement.ts`, `src/engine/confinement-policy.ts`, `src/engine/run.ts` | Narrowing, ordered comparisons, C2 and C3 checks, scenario proof grants and witnesses. |
| `src/engine/schema.ts`, `schemas/agent-scenario.schema.json`, `scripts/run-scenarios.mjs` | Witness and proof-grant fixture fields, current schema export and targeted baseline regeneration. |
| `src/trust/resolver.ts`, `src/reference/fixtures.ts`, `src/reference/main-fixtures.ts` | Role resolution and reference lender-role evidence. |
| `scenarios/mortgage-main.json` | Signed lender roles, exact parameters on the selective-disclosure proposal, scoped proof grants and the lane B mailbox and principal-fault branch endings. |
| `scenarios/mortgage-core.json`, `scenarios/mortgage-injected-fee.json`, `scenarios/mortgage-out-of-limit.json`, `scenarios/mortgage-over-ask.json` | Explicit lender-role requirements and register entries. |
| `scenarios/fee-dispute.json`, `scenarios/onward-leak.json` | Peer witnesses and fixed response commitments for the whole-record fixtures. |
| `test/branch-comparison.test.ts`, `test/configuration-extends.test.ts`, `test/confinement.test.ts`, `test/email.test.ts`, `test/forum.test.ts`, `test/forum-range.test.ts`, `test/later-bars.test.ts`, `test/register-freshness.test.ts`, `test/regulator-claim-alternative.test.ts`, `test/trust-pinned-mortgage.test.ts` | Focused regressions listed above. |

## Generated paths

- Regenerated 43 traces using selected scenario and configuration runs. The 12 baseline traces cover fee-dispute, onward-leak and the five mortgage scenarios with lender-role terms. The 31 alternative traces cover the regulator claim, reputation post, vendor fault, selective disclosure, DID identity, anonymous identity, email endpoint, plain-language upgrade, human approval and pinned-list configurations of mortgage-main.
- Refreshed the seven changed outlines. The regulator claim and reputation post outlines include the companion proof checks. The principal-fault and mailbox prose outlines show the earlier evidence stops.
- Updated five rows in `scenario-runs.json`. The regulator claim and reputation post main rows have new consequence sequence numbers. The mailbox prose and principal-fault rows now agree with their expected stops. On the pinned-list stranger branch, ordered comparison detects an earlier admission that differs from the main. The source check still refuses the stranger's record. The manifest has 249 runs, 20 disagreements and 14 blocked paths. `traces/index.json` refreshes seven event counts. Both files retain their original row order.
- The scenario runner recorded `unknown` in the generated commit field because its Node child-process call for Git is restricted in this workspace. The traces were generated from this working tree based on `5e5a46aafc13d1c73209a1208f5a7a6fa67969e3`.

## Validation

- The 17-file focused batch passed all 84 tests. The follow-up covering confinement, DID, pinned registration, register freshness and the oracle snapshot tool passed 22 tests across six files. The all-configuration confinement test was outside that focused selection. C3 preflight accepted all 38 registered configuration patches.
- Compiled with Node 24 using `tsc -p tsconfig.build.json`, copied generated assets and checked the exported schemas.
- Package typecheck and lint passed. Lint emitted warnings and informational diagnostics. The RDF pipeline guard reported 0 failures with 213 allowances.
- The 12 regenerated live baseline projections match the oracle. The recorded artifact snapshot matches all 164 paths, and `test/oracle/pre-rdf.json` is unchanged.
- `git diff --check` passed. Changes remain in the working tree.
