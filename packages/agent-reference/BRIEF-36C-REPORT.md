<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 36c integration report

The work is in `/home/user/lanes/int3` on `claude/project-thread-ee3kq8-int3`. The oracle fixture retains SHA-256 `748c4955e9facabea0dc4c8eb912fb9bad66a89d8a5b25c795db321ced75aa5c`.

## Review fixes

| Finding | Change | Regression coverage |
| --- | --- | --- |
| 1. Publication | Compact statement admission retains a digest of the signed bytes. Publication requires that digest alongside current signature, source, admitted statement and recipient checks. Bounded JSON checks object member names after escape decoding. Stored facts from before this change need the original statement to be admitted again before publication. | `email.test.ts` checks a valid reserialization with the same parsed value, a valid signature over an escaped duplicate member, a nested field substitution and successful publication of the exact admitted bytes. `wire.test.ts` checks duplicate handling in JSON-LD before key lookup. |
| 2. Range and whole-record disclosure | The exact fee invoke joins the proof-grant inventory for its sender. Whole-record releases inspect the signed forum request, segment, rows, row proofs and archived messages. They require scoped grants for the exact segment and signed companion artifacts. The gate computes the credentials for disclosure and terms checks from those bytes and verifies them against admitted facts. | `regulator-claim-alternative.test.ts` withholds only the fee invoke grant. `forum.test.ts` stops a whole-record release without grants and exercises the authorized fee and onward-leak cases. |
| 9. DID confinement | Preflight rejects shared DID documents for distinct identity and actor names. The runtime aliases typed identity references and rejects duplicate keys when rekeying identity policy maps. The mortgage DID fixture assigns three agent identities distinct documents from their actors. | `configuration-extends.test.ts` checks the same-party collision, collision in the terms-acceptance map and preservation of opaque statement fields. `did.test.ts` exercises the DID mortgage and the unlisted DID method. |
| File-ledger recovery | A file-derived head must match the durable state checkpoint when a runtime opens. An unmatched suffix prevents audit and record export, and later state writes preserve the checkpoint. A clean initialization saves its own writer head. | `email.test.ts` covers a self-consistent suffix, a damaged suffix, repeated reopen and a clean checkpoint with an unavailable historical approval key. `record-audit.test.ts` exercises audit checks. |
| Structured free text | The context gate stops on a missing regulated role, including inherited role terms, before evaluating text approval. | `content.test.ts` checks the stop both with and without approval. `later-bars.test.ts` exercises the supplier-terms balance-copy branch. |
| Federation and regulated roles | The federation resolver passes registered-role requests to the normal registration resolver. The installed federation policy attests membership, purpose and claim types. | `trust-federation-proofs.test.ts` distinguishes ordinary recipient routing from registered-role lookup after a valid chain has been verified. |
| Register-entry selection | Register and entry lookup use the same party-and-role predicate. | `register-freshness.test.ts` places an operation-only entry ahead of the valid role entry and checks the role entry's expiration. |
| Legacy approval redaction | A peer that privately reviews the original legacy row can attest the exact public chain fields in its signed terminal receipt. The forum checks that attestation against the range and continues to require completeness for every other redaction. Approval notes and signatures are absent from the disclosed row. | `forum.test.ts` checks a witnessed redaction, a missing attestation and an attestation for different chain fields. |
| Brief 35 aggregate oracle | The oracle uses the installed aggregate adapter when present. On a checkout without the adapter it verifies the SHA-256 of the six pinned recordings. `ANSWERABLE_REQUIRE_LIVE_AGGREGATE=1` requires the live adapter. The test prints its mode. | `oracle.test.ts` checks absent-adapter selection and the required-live failure. `recorded-joint.test.ts` checks recording provenance and hash verification. |
| Brief 35 proof of absence | Coverage uses the rule's positive inputs. A condition used solely under `not-in` can be satisfied by the verified complete dataset. Positive conditions and completeness evidence still have independent checks. | `sparq-zk-query.test.ts` covers an empty medication list, a missing completeness binding and a missing positive completeness claim. |

The review already marked items 8, 11, 12, 13 and 14 resolved, along with private approval storage, unrelated invoke filtering and mailbox restart. Their existing coverage was included where it overlapped these changes.

## Merge sanity

The literal ref `401c1acd4^2` is unavailable because `401c1acd4` is a single-parent commit. I used the first-parent diffs for `a2aafec8d`, `c88d54ebf`, `75f2741da` and `5717d9663`, plus the second parent of merge `75f2741da`.

- The two Solid configurations had executable implementations and stale blocked manifest rows. I regenerated the five affected traces and their manifest and index entries.
- The proof merges left five executable proof paths marked blocked. I regenerated age check, introduction, hidden right-to-work validity, tenancy and visa. The manifest now reports 259 runs, 20 disagreements and five blocked paths. The label test keeps exact count and identifier assertions for the expanded manifest.
- The RDF guard found three merge violations. The query fixture now parses adapter output through the bounded wire reader. The single-use profile passes the exact parameter digest into the gate and retires one earlier allowance.
- Proof senders were being held for missing evidence even after the runtime generated the exact required result. The outbound gate recognizes only a gate-authored proof supplied for the same recipient and purpose, checks its proof digest and rechecks retained input digests and terms. It applies the narrower-disclosure check before assessing missing proof coverage when the sender proposes the underlying private input.
- Visa and tenancy used the proof-answer operation for a second exchange carrying ordinary supporting statements. Each profile now declares a separate operation with its own claim requirements, routing and mandate permission. The proof-answer operations retain their proof-result requirements.
- The regulator-claim gap reaches the forum's fitness refusal. The reputation-post evidence branch stops at disclosure. Both match their declared outcomes under the merged comparator. The salary-benchmark seam now checks that the aggregate branch stops and matches the registered prohibition.

### Frozen baseline divergences

Both oracle modes first stop at `contract-wording/branch-1`, check position 67, where the merged owner denial adds an `approval-denied` decision. A separate read-only comparison reached 145 historical paths and found further sequence differences in `employment-reference/branch-1`, `flat-share/branch-1`, `hardship-request/branch-1` and `probing-counterparty/tenth-request`.

An independent live aggregate run matched `salary-benchmark/main` and differed at position 134 on `salary-benchmark/branch-1`. The employer's aggregate release now stops at data terms. The six historical aggregate recordings still verify against their pinned hashes.

That comparison also found scenario errors before it could obtain all paths for `emergency-access`, `health-referral`, `insurance-claim-photos`, `master-data-change`, `pay-an-invoice` and `supplier-onboarding`. The insurance photo fixture reaches an approval step with no pending approval. The other scenarios fail their declared catalogue outcome checks. The focused catalogue suite reproduces the insurance error, and the hardship approval wording test reaches its frozen oracle comparison before failing on the merged denial sequence. I stopped work on those historical paths under the brief's oracle rule.

## Changed paths

| Paths | Reason |
| --- | --- |
| `src/core/limits.ts`, `src/wire/{bounded-json,document,jws-compact,strict-json}.ts` | Shared duplicate-member rejection and the existing malformed-document outcome. |
| `src/gates/{common,inbound,outbound}.ts`, `src/runtime/agent.ts` | Exact admitted proof commitments, role checks, record release, durable ledger trust and exact sender-side proof support. |
| `src/mechanisms/forum.ts`, `src/store/ledger.ts` | Verify peer-attested selective disclosure and preserve the original ledger chain. |
| `src/engine/{confinement-policy,identity-names,run}.ts`, `src/standins/did.ts` | Preflight and apply identity aliases, prepare explicitly authorized record grants and digest single-use parameters. |
| `src/trust/resolver.ts`, `src/suites/trust-federation.ts` | Resolve regulated roles using matching registration evidence. |
| `src/derive/{verification,adapters/sparq-zk-query}.ts`, `scripts/rdf-pipeline-allowlist.json` | Verify proof coverage and route native JSON through the wire parser. |
| `scenarios/{fee-dispute,mortgage-main,onward-leak}.json` | Declare the exact record proof owners in the redress fixtures and use distinct DID aliases. |
| `profiles/{tenancy-application,visa-application}.json`, `scenarios/{tenancy-application,visa-application}.json` | Give signed supporting statements their own scoped operation and claim requirements. |
| `test/{configuration-extends,content,email,forum,labels,oracle,register-freshness,regulator-claim-alternative,reputation-post-alternative,seam-scenarios,sparq-zk-query,trust-federation-proofs}.test.ts` | Exercise the reported findings at their release, verification or scenario entry points and check coverage of the regenerated trace set. |
| `scenario-runs.json`, `traces/index.json`, selected files under `traces/` | Refresh the affected disclosure, Solid access and proof runs. |

## Verification

| Check | Result |
| --- | --- |
| Package typecheck, TypeScript build, generated-runtime copy and schema export check | Passed under Node 24.22.3. |
| Whole-package lint | Passed with zero errors, 613 warnings and 527 informational diagnostics. |
| RDF pipeline | Passed with zero failures and 212 explicit allowances. |
| Aggregate oracle modes | The live and fallback mode checks passed. Both full comparisons stopped on the same existing `contract-wording/branch-1` outline mismatch. The fallback printed `SHA-verified recordings` and the installed adapter printed `live adapter`. |
| Query and result adapter tests | 32 passed with the installed WASM backend, including the real pinned Boolean round trip and the empty-medication regression. The first run with the native binaries returned `native witness execution failed`. |
| Review regression batch | 122 passed across 13 files, including publication, file restart, forum, duplicate-member handling, registered roles and the six SHA-verified recordings. |
| Merge-focused batch | 115 passed across 12 files, including all 20 scenario seam tests, the named Solid runtime tests and the comparator. The catalogue insurance approval failed. The label count was updated for the generated proof and Solid traces and rerun separately. |
| Artifact and alternative rerun | 13 passed across the label, Solid manifest, regulator claim and DID files. |
| Affected scenario generation | Twelve selected scenario/configuration combinations plus four deliberate proof-blocker checks ran with the installed adapters. Verified 28 selected trace/index pairs and all six aggregate recording hashes. |
