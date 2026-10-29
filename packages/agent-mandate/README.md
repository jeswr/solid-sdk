<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-mandate

> Experimental — AI-agent-generated. Security-critical; private pending suite conformance.

VC-wrapped ODRL mandates, owner approvals, and injectable policy engines for DESIGN D3 / §4.2
(A-008, bead sst-gpa). This package never sends messages, fetches a pod, or reads credentials.
Every read, key resolution, revocation check, process invocation and clock is explicit.

`defaultMandate({ id, ownerWebId, agentWebId, recipientHashes, now })` builds the 30-day v1
mandate: empty autonomous permissions, Gmail sends to salted account hashes with approval,
and prohibitions on Transfer, Sign and appointments costing more than zero. Hashes have the
form `sha256:<64 lowercase hex characters>`; callers supply the salt and calculate hashes.
`limitConstraint(operand, value, enforcement)` builds the spendPerDay, spendPerWeek,
perRecipientPerDay and sendsPerDay ODRL vocabulary with `hard` or `soft` enforcement.
Actual accounting and enforcement belong to agent-executor.

`issueMandate(mandate, ed25519Key, { statusListCredential, statusListIndex })` creates a
`solid-vc` AgentAuthorizationCredential with an embedded ODRL Agreement and
`eddsa-rdfc-2022` proof. The complete policy graph is signed. Use `mandateToTurtle` to store
it and `parseMandateCredential` to read the package-issued Turtle representation; parsing
alone does **not** establish authority. Extra, ambiguous, malformed or unrepresentable
claim graphs fail closed. All IRIs use the namespace `https://jeswr.org/ns/agent#`.

`createVcMandateVerifier({ read, ownerWebId, agentWebId, statusListCredential,
webIdKeyResolver, resolveStatus, now }).load()` returns a verified mandate or `undefined`.
Inject `solid-vc`'s `createWebIdKeyResolver` with a scoped fetch, and its
`createBitstringStatusResolver` with a scoped fetch and the same key-control seams.
The status-list URL must end in `/agent/mandates/status.ttl`. Missing, unreadable,
revoked or otherwise unconfirmed status refuses all authority. The upstream bitstring
resolver reads a signed JSON/JSON-LD status-list credential, even at this `.ttl` URL;
its fetch seam can adapt the storage representation. Mandate Turtle itself is supported.

The verifier uses `agent-authz-verifier` for credential integrity, owner/agent cross-binding,
and revocation. Its empty Agreement projection deliberately delegates Phase D to the
separate PolicyEngine: only successful phases A/B/C can expose the embedded policy sets.
It never treats a policy denial as permission to transmit.

`evaluateIntent(verifiedMandate, intent, engine?)` returns a decision plus a stable reason:

- `refuse-all`: missing/invalid mandate, expired or future validity, wrong agent.
- `prohibited`: a matching prohibition in any set, before any permit or indeterminate result.
- `confirm-required`: with-approval permission, missing context, outstanding duty,
  unsupported vocabulary, engine failure, or no matching rule.
- `permit`: autonomous permission after every preceding check passes.

The default `solidOdrlEngine` preserves the workspace evaluator's standard action
implications (including `write` covering `append`) and matches agent actions exactly before
lowering matching rules to ODRL `use`. The standard `use` umbrella excludes ACL control,
delegation, ownership transfer and custom agent actions. Prohibition always wins,
including when an input policy declares `conflict: perm`. Unsupported policies require
confirmation. `Intent.attributes` is trusted executor context, including duty-discharge
flags; it must not be copied from model assertions.

Typed decimal values must retain their decimal identity through the evaluator's `Number`
conversion; insignificant zeros and exponent formatting do not change that identity.
Date-time operands must have millisecond precision (additional trailing zeros are accepted).
Values that would lose precision require confirmation, including in prohibitions and duties.
Typed float values also require confirmation whenever binary32 rounding changes their value.

`issueApproval({ id, approves, termsDigest, expires, decision }, p256Key, now)` produces
Turtle with a Data Integrity `ecdsa-rdfc-2019` proof. It accepts a non-extractable WebCrypto
P-256 private key without exporting it. `verifyApproval(turtle, { id, ownerWebId, proposal,
termsDigest, webIdKeyResolver, now })` checks suite/purpose, the owner's authoritative
WebID assertionMethod, the canonical graph signature, proposal, digest, expiry and decision,
in that order. Verification material inside the statement is never trusted. Digest
comparison hashes both inputs to fixed-size arrays before constant-work comparison.

**Native browser issuance remains blocked by an upstream dependency:** the workspace
`solid-vc` Data Integrity hashing implementation imports `node:crypto`. P-256 issuance and
non-extractable keys are exercised in Node 24 tests; a browser build needs that dependency
to expose browser-compatible hashing. This lane does not replace its crypto implementation.

The optional Node adapter is isolated at `@jeswr/agent-mandate/sparq`:
`sparqPolicyEngine({ binary, timeoutMs? })`. It uses the pilot `sparq-policy-decide/1`
protocol, no shell, an empty environment, bounded time/input/output, and no evaluator
fallback. An absent binary or any protocol/process failure is indeterminate. Duties are
conservatively indeterminate in this adapter. Tests exercise protocol and process boundaries;
a real sparq binary is not installed or executed.

`createLegacyMandateVerifier({ read, ownerWebId, agentWebId, resolvePinned, isRevoked, now })`
imports pilot `awp-mandate+jws` OwnerMandates using locally pinned EdDSA/ES256 keys. Embedded
key/header extensions, invalid identity/time windows, unsupported pilot terms, and revocation
fail closed. No runtime JWS issuance API exists. The fixture generator in
`scripts/generate-legacy-fixture.mjs` ports the pilot scheduling template and writes only a
synthetic signed statement and public JWK. Per-policy pilot decisions are retained; unmatched
requests follow the new DESIGN rule `confirm-required`.

`./testing` exports `memoryMandateVerifier` and `scriptedPolicyEngine` for downstream tests.
The 64-row decision matrix names the expected decision and reason on every row. Run the
package lint, build, typecheck and test scripts; tests enforce 100% branches, functions,
lines and statements per source file.
