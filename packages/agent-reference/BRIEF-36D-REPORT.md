<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 36d review fixes

| Finding | Fix and regression |
| --- | --- |
| Whole-record disclosure and inherited terms on raw content | The release gate matches each raw row to the exact retained content and binds the signed entry to that row. It checks the whole-record purpose and the raw item's inherited terms before release. Signed companion messages carrying raw content must match an inventoried part. The forum regression supplies valid proof grants and checks both an inherited prohibition and an inherited permission. |
| Part 3 registration hard stop for plain email | Plain email uses the structured gate's recursive registration check when the text repeats a held value. The regression obtains an exact-text approval, admits a statement with a nested registration rule, and confirms that release stops with `not-authorised`. |
| Ledger suffix recovery | The runtime verifies and reads the prefix ending at the durable head. A later suffix stays outside the trusted checkpoint and audit scope. A prefix-only audit returns its findings without issuing a new record entry. The file-ledger regressions exercise a real append before state save and a reconstructed extension through two reopens, and verify that damage within the prefix still blocks audit and export. |
| Legacy approval redaction and runtime export coverage | Both runner witness calls supply original legacy approval rows from the verified interval. The new scenario regression seeds a pre-commitment approval and drives `witnessRecordHead()` and `exportRecord()`. It checks the redacted row and the absence of the original bytes. The forum's existing witness verification tests also ran. |
| Proof of absence when a separate issuer supplies the absent kind | Verified completeness can cover an omitted issuer only if local source policy accepts it for a negative-only input and for none of the positive inputs. The regression uses a separate medication issuer and checks that the verifier still refuses a missing positive kind, a missing positive supplier, or an incomplete proof. |
| Unverified ledger observations and proof reuse | The runtime persists an authorship binding to the ledger position, exact proof bytes, task and digest of the admitted request. Required outgoing evidence also needs the current request for that task, recipient, purpose and rule. The regression permits a genuine proof and refuses a signed proof referenced only by an observation, the genuine proof in another task, and the genuine proof after a newer request arrives. Existing proofs without the durable binding cannot satisfy this check. |
| DID rewrite of typed organization binding | The identity rewrite aliases `organizationCredentials[].entity`. The organization regression follows the aliased supplier through mandate signing and the buyer's inbound authority check. |
| Salary joint regression | The test requires `branch-1` to execute and show the outbound data-terms prohibition even if there is no test-double marker. Removing the branch in the isolated fixture makes the regression fail. |

## Previously resolved findings

| Finding | Verification |
| --- | --- |
| Publication binding | The publication and compact-wire tests cover exact admitted bytes, recipient binding, and escaped duplicate members. |
| Fee invoke in range disclosure | The regulator claim regression removes only the exact invoke grant and confirms that the range release stops. The forum range tests also passed. |
| DID confinement collisions | The configuration tests cover identity and policy-map collisions. |
| Federation membership and regulated roles | The federation and registration tests exercise the regular resolver for a registered-role request. |
| Register entry selection | The registration regression places the operation-only entry before the role entry and checks role expiry. |
| Brief 35 recordings fallback | The oracle's mode test and the recorded-joint tests passed. |

## Frozen oracle and generated artifacts

The live oracle verified all 163 Brief 37 paths with the pinned aggregate adapter required. An independent comparison of the checked-in trace projections also matched all 163 paths. The oracle file has SHA-256 `4f63d12f5e58b1d4a2f085c3d524b671663a1d96dd61c45ee875838d1308922f`.

The affected scenario runs matched the manifest outcomes and recorded decision sequences. Paired runs of the parent and fixed implementations showed the same differences from the recorded traces in rendered scope fields and fresh proof packets. No trace, outline, or manifest row required regeneration.

## Changed paths

- Source. [derive/verification.ts](src/derive/verification.ts), [engine/identity-names.ts](src/engine/identity-names.ts), [engine/run.ts](src/engine/run.ts), [gates/outbound.ts](src/gates/outbound.ts), [runtime/agent.ts](src/runtime/agent.ts), [store/state.ts](src/store/state.ts).
- Tests. [email.test.ts](test/email.test.ts), [forum.test.ts](test/forum.test.ts), [organizations.test.ts](test/organizations.test.ts), [seam-scenarios.test.ts](test/seam-scenarios.test.ts), [sparq-zk-query.test.ts](test/sparq-zk-query.test.ts).
- Report. `BRIEF-36D-REPORT.md`.

## Checks

- The five directly affected test files passed all 75 tests. Seven adjacent files passed all 42 tests. The targeted regulator-claim grant test passed. A final run of the ten new or updated regressions passed.
- Nine regression cases failed as expected in an isolated copy of the parent implementation. The proof case detected all three unauthorized paths. The salary branch-removal mutation also failed as expected.
- Node 24 package typecheck, Biome lint, schema export check, and workspace RDF discipline check passed. The package RDF pipeline reported 0 failures and 212 explicit remaining violations.

Changes are in the working tree.
