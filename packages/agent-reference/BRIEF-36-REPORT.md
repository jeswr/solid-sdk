<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 36 review fixes

## Findings and regressions

| Finding | Fix | Regression |
| --- | --- | --- |
| High · Publication released unchecked bytes | `runtime/agent.ts`, `runtime/operations.ts`, `engine/run.ts` and `gates/outbound.ts` resolve the adapter's actual host and verify each original signature and payload digest against its admitted fact. The adapter receives the same parameters evaluated by the gate. | `email.test.ts` binds publication to the admitted fact digest and the host's resolved identity. |
| High · Range export omitted payloads from the terms check | `store/ledger.ts`, `runtime/agent.ts` and `mechanisms/forum.ts` retain chain commitments for withheld rows. The release derives its terms-check items from the exact signed request and archive bytes. Range export exposes only supported record metadata and the verified fee notice. | `email.test.ts` redacts private email action parameters from the exact range export bytes and checks the nested entry proofs. |
| High · Approval could override an item prohibition | `gates/outbound.ts` and `mechanisms/mandate.ts` evaluate the item and release scope with the shared mandate evaluator. An explicit denial or indeterminate decision stops the release. | `principal-use.test.ts` checks an item prohibition with and without an approval. |
| High · Unrelated agreement supported a fee finding | `mechanisms/forum.ts`, `engine/run.ts` and the mortgage fixture bind the signed fee statement to the offer, conversation, agreement ID and terms digest. The forum checks both agreement signatures and addressees and the respondent-to-claimant notice. | `forum-range.test.ts` checks a bound agreement, an agreement for another transaction and a notice sent in the opposite direction. |
| High · Stale register answers renewed authorisation | `runtime/agent.ts` and `trust/resolver.ts` retain signed timestamps and validity. Both resolver entry points select the latest answer and apply a fixed expiry. An expired update cannot revive an earlier grant. | `register-freshness.test.ts` checks the signed validity limit, a later suspension and the interval after that suspension expires. |
| High · A fault branch could overwrite main | `engine/load.ts`, `engine/run.ts` and `scripts/run-scenarios.mjs` reserve `main` and use the explicit path kind for fault placement and file naming. | `gate-fault-guards.test.ts` rejects a vendor-fault branch named `main`. |
| Medium · Mailbox proof could precede delivery or be replayed | `runtime/agent.ts` generates a nonce, activates it only when the exact effect reports completion, and consumes it for the pinned mailbox and purpose. `engine/run.ts` supplies deterministic entropy for the script fixture. | `email.test.ts` checks pre-delivery rejection, a missing nonce, success after delivery and replay rejection. |
| Medium · Record-backed claims could invent chain points or name another operator | `runtime/agent.ts` checks the audit hash, mandate, component digest, action digest, decision and release points together. The named component statement must describe the releasing actor and name the actual recipient as the gate operator. | `vendor-fault-alternative.test.ts` checks a different digest, fictitious chain points and a recipient the component statement does not name. |
| High · Configuration policy changes escaped C3 | `engine/confinement.ts`, `engine/confinement-policy.ts` and `engine/run.ts` enforce C3 before execution, including inherited configurations, effective profile changes, mandate additions, trust changes and the exact fields a layer owns. | `configuration-extends.test.ts` checks an altered representation requirement, a blanket mandate grant, a trust-root override and an out-of-layer replacement. |
| Medium · Prerequisites could mix `requires` and `extends` | `engine/matrix.ts` requires a named prerequisite to have neither dependency field. | `configuration-extends.test.ts` rejects a prerequisite that itself extends another configuration. |
| Medium · C2 accepted mismatched approval or an unchecked message | `engine/confinement.ts`, `trace/types.ts`, the gates and the runtime associate carriage events with the exact gate run. A resumed gate run must pass on the approved action digest. | `confinement.test.ts` substitutes an approval for another digest and removes a message's full gate run. |
| Medium · Post-stop effects escaped the guard | `engine/compare.ts`, `engine/run.ts` and `gates/outbound.ts` bind the stop to an action digest and validate later releases in the same scope against a narrower proposal. The ordered comparison reports the first changed decision. The selective-disclosure fixture now proposes a superset of the later authorised claims. | `branch-comparison.test.ts` checks attempted release of the stopped proposal and a changed successful decision before the expected stop. |
| Medium · The forum accepted an arbitrary range end | `store/ledger.ts`, `mechanisms/forum.ts`, `runtime/agent.ts` and the mortgage fixture bind the signed terminal receipt to the conversation and start. The forum request fixes the respondent's terminal commitment before the answer arrives. | `forum-range.test.ts` covers empty and tail-truncated signed ranges. |
| Medium · Audit trusted an unverified approval row | `mechanisms/record-audit.ts`, `mechanisms/mandate.ts`, `runtime/agent.ts` and `store/ledger.ts` use a trusted head and check the original owner signature, digest, conversation, release-time validity and earlier consumption. Missing evidence yields an indeterminate audit. | `record-audit.test.ts` checks an unverified row, a rejected verification, a reused approval and a ledger that fails to reach its trusted head. |

## Recorded paths

All paths below are relative to the package. Each listed file was regenerated with the selected scenario and configuration after compiling with `tsc -p tsconfig.build.json`. The table lists the outlines that changed as well as the affected traces.

| Files | Reason |
| --- | --- |
| `traces/mortgage-main--accountability-regulator-claim.json` and `outlines/mortgage-main--accountability-regulator-claim.json` | Adds the lender-held fee statement and both terminal commitments. The forum still finds the lender at fault on the bound agreement. |
| `traces/mortgage-main--entry-withheld--accountability-regulator-claim.json` and `outlines/mortgage-main--entry-withheld--accountability-regulator-claim.json` | Uses the witnessed interval and redacted range format. The forum refuses the missing entry at fitness. |
| `traces/mortgage-main--accountability-reputation-post.json` and `outlines/mortgage-main--accountability-reputation-post.json` | Inherits the verified fee finding and publishes the exact admitted review and decision to the resolved host. |
| `traces/mortgage-main--post-about-a-person--accountability-reputation-post.json` and `outlines/mortgage-main--post-about-a-person--accountability-reputation-post.json` | Inherits the verified fee finding. The decision terms still prohibit publication about the named person. |
| `traces/mortgage-main--evidence-not-publishable--accountability-reputation-post.json` and `outlines/mortgage-main--evidence-not-publishable--accountability-reputation-post.json` | Inherits the verified fee finding and verifies the candidate publication bytes. The disclosure check still stops the balance statement. |
| `traces/mortgage-main--accountability-vendor-fault.json` | Records exact release bindings while the audit verifies original approvals and reports the clean run within mandate. |
| `traces/mortgage-main--gate-released-outside-mandate--accountability-vendor-fault.json` | The claim carries the verified audit hash and exact chain points for the release outside mandate. |
| `traces/mortgage-main--fault-was-the-principals--accountability-vendor-fault.json` | The claim uses the current audit record. The gate still refuses it for lack of a matching outside finding. |
| `traces/mortgage-main--identity-anonymous.json` | Records the gate binding for the signed register exchange under fixed answer validity. |
| `traces/mortgage-main--anonymous-asks-for-more--identity-anonymous.json` | The ordered comparison finds an earlier differing go decision. The later authority refusal still occurs. |
| `traces/mortgage-main--identity-email-endpoint.json` | Records the confirmed-delivery challenge exchange and exact approval and gate bindings. |
| `traces/mortgage-main--mailbox-reply-as-evidence--identity-email-endpoint.json` | Uses the confirmed-delivery challenge exchange. Prose still fails as structured evidence. |
| `traces/mortgage-main--meaning-plain-language-upgrade.json` | Uses the confirmed-delivery challenge and scopes the description requirement to the added operation. |
| `traces/mortgage-main--prose-as-evidence--meaning-plain-language-upgrade.json` | The ordered comparison finds an earlier differing go decision. The operation still asks for structured evidence. |
| `traces/mortgage-main--step-back-down--meaning-plain-language-upgrade.json` | Uses the confirmed-delivery challenge. The signed description still prevents fallback to prose. |
| `traces/mortgage-main--usage-control-human-approval.json` | Records matching approval and resumed action digests for the principal’s own statement. |
| `traces/mortgage-main--approval-reused--usage-control-human-approval.json` | The ordered comparison detects an earlier go to a different agent. A new approval is still requested. |
| `traces/mortgage-main--supplier-terms-hold--usage-control-human-approval.json` | The ordered comparison detects an earlier differing go. The excess disclosure still stops before approval. |
| `traces/mortgage-main--withheld-claim-asked-for--authenticity-selective-disclosure.json` | The stopped proposal includes both otherwise allowed items and the private number. The distinct, narrower proposal still completes. |
| `traces/index.json` | Refreshes event counts for the five regulator and reputation-post traces that gained a lender-side statement admission. |
| `scenario-runs.json` | Rebuilds the changed rows in their original order. The 283 paths now comprise 248 runs, 21 disagreements and 14 blocked paths. The baseline rows match their prior values. |
| `schemas/agent-scenario.schema.json` | Adds the terminal witness and requested response endpoint fields used by range export. |

C6 uses ordered comparisons for suite-specific and scoped-stop branches. Existing catalogue branch classification stays compatible with the baseline. Legacy whole records remain readable. The range exporter can disclose the verified structured fee notice and its scoped agreement proof. Other raw payloads in the interval are represented by chain commitments.

## Validation

- Node 24.22.3. Package build compilation and exported-schema check passed.
- Focused Vitest batches with two workers passed 47 tests across nine files and 13 scenario integration tests across seven files.
- The final scoped-stop and confinement batch passed 10 tests across three files.
- Three selected baseline tests passed across `forum.test.ts` and `engine.test.ts`, including the fee and onward-leak cases and probing branches.
- Package typecheck and lint passed. The RDF guard reported zero failures.
- All 38 declared configuration patches pass C3 preflight. The recorded snapshot matches all 164 oracle paths, and the oracle file is unchanged.
- Final verification uses focused tests only. The orchestrator owns the full gate under the memory constraints in the resume note.
