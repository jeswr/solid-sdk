<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-mandate

> Experimental — AI-agent-generated. Security-critical; private pending suite conformance.

VC-wrapped ODRL mandates, owner approvals, and injectable policy engines for DESIGN D3 / §4.2
(A-008, bead sst-gpa). This package never sends messages. Pod credential reads use the explicit fetch adapter below.
Every read, key resolution, revocation check, process invocation and clock is explicit.

`defaultMandate({ id, ownerWebId, agentWebId, recipientHashes, now })` builds the 30-day v1
mandate: empty autonomous permissions, Gmail sends to salted account hashes with approval,
and prohibitions on Transfer, Sign and appointments costing more than zero. Hashes have the
form `<64 lowercase hex characters>` or `sha256:<64 lowercase hex characters>`; callers supply the salt and calculate hashes.
`limitConstraint(operand, value, enforcement)` builds the spendPerDay, spendPerWeek,
perRecipientPerDay and sendsPerDay ODRL vocabulary with `hard` or `soft` enforcement.
Actual accounting and enforcement belong to agent-executor. Set `mandate.currency` (an ISO 4217
code, signed into the agreement as `schema:currency`) whenever the mandate has spend limits: the
executor refuses any action under a spend limit whose currency it cannot authenticate.

`issueMandate(mandate, ed25519Key, { statusListCredential, statusListIndex })` creates a
`solid-vc` AgentAuthorizationCredential with an embedded ODRL Agreement and
`eddsa-rdfc-2022` proof by default. A fourth options argument `{ cryptosuite: "ecdsa-rdfc-2019" }`
signs with the browser owner's non-extractable P-256 key. The verifier accepts exactly one proof
using either of these two suites; every other suite is rejected. `mandateCredential(m, status)`
builds the unsigned claim graph for previews. The complete policy graph is signed. Use `mandateToTurtle` (the
historical export name) to serialize TriG and `parseMandateCredential` to read it. Serve
the document as `application/trig`, for example at a `.trig` URL. Each proof lives in a
named graph with a `sec:multibase` signature literal, matching the standard Data Integrity
JSON-LD context. Parsing alone does **not** establish authority. Extra, ambiguous, malformed
or unrepresentable claim graphs fail closed. All IRIs use `https://jeswr.org/ns/agent#`.

`createVcMandateVerifier({ read, ownerWebId, agentWebId, statusListCredential,
webIdKeyResolver, resolveStatus, now }).load()` returns a verified mandate or `undefined`.
Inject `solid-vc`'s `createWebIdKeyResolver` with a scoped fetch, and its
`createBitstringStatusResolver` with a scoped fetch and the same key-control seams.
The status-list URL must end in `/agent/mandates/status.ttl`. Missing, unreadable,
revoked or otherwise unconfirmed status refuses all authority. The upstream bitstring
resolver reads a signed JSON/JSON-LD or TriG status-list credential at this `.ttl` URL.
Use `solid-vc`'s `statusListCredentialToTurtle` / `parseStatusListCredential` for lossless
TriG transport. Parsing is structural; signature and issuer checks remain mandatory.

The verifier uses `agent-authz-verifier` for credential integrity, owner/agent cross-binding,
and revocation. Its empty Agreement projection deliberately delegates Phase D to the
separate PolicyEngine: only successful phases A/B/C can expose the embedded policy sets.
It never treats a policy denial as permission to transmit.

`evaluateIntent(verifiedMandate, intent, engine?)` returns a decision plus a stable reason:

- `refuse-all`: missing/invalid mandate, expired or future validity, wrong agent.
- `prohibited`: a matching prohibition in any set, before any permit or indeterminate result.
  A prohibition also matches a request for a broader action that covers it (a `write` request
  matches an `append` prohibition).
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
A set-valued request operand requires confirmation under an `isAnyOf` permission, duty or obligation
constraint (one allowed value cannot carry others through an allowlist) and under an `isNoneOf`
prohibition constraint (one listed value cannot switch the prohibition off). Under an `isAllOf`
permission, duty or obligation constraint it requires confirmation when it holds a value the
constraint does not list (`isAllOf` alone accepts any superset). Targets and actions match exactly; the
executor must canonicalise target IRIs before evaluation.
Typed float values also require confirmation whenever binary32 rounding changes their value.

`issueApproval({ id, approves, termsDigest, expires, decision }, p256Key, now)` produces
TriG (`application/trig`) with a Data Integrity `ecdsa-rdfc-2019` proof. It accepts a
non-extractable WebCrypto P-256 private key without exporting it.
`verifyApproval(trig, { id, ownerWebId, proposal, termsDigest, webIdKeyResolver, now })`
checks suite/purpose, the owner's authoritative
WebID assertionMethod, the canonical graph signature, proposal, digest, expiry and decision,
in that order. Verification material inside the statement is never trusted. Digest
comparison hashes both inputs to fixed-size arrays before constant-work comparison.

Browser callers import `@jeswr/agent-mandate/approval`, `@jeswr/agent-mandate/control`,
`@jeswr/agent-mandate/issue` and `@jeswr/agent-mandate/verify`. The latter two expose
mandate composition/signing and verification/policy evaluation without expanding the UI layer allowlist.
These entry points and `src/mandate.ts` bundle for browsers, use WebCrypto and the browser-compatible
`solid-vc` build, and accept non-extractable P-256 private keys. The optional `./sparq`
adapter remains Node-only.

`issueControlStatement({ id, kind, attributedTo, createdAt, expires, target?, binding?,
bindingState?, restrictions? }, p256Key, now)` signs a TriG control statement using the existing
agent-model vocabulary and RDF mapping (including `prov:wasAttributedTo`, `dct:created`
and typed date-time literals). The record's `type` discriminator is implicit in RDF;
`proof` is produced by the signer. `verifyControlStatement(document, { id, ownerWebId,
webIdKeyResolver, now })` checks the suite/purpose, authoritative P-256 assertion key,
complete graph signature, exact owner attribution and expiry, and returns either
`{ valid: true, statement }` or `{ valid: false, reason }`. Failures are `proof-type`,
`key`, `signature`, `attribution`, `expired` or `malformed`. SetBindingState requires
target, binding, and either bindingState or restrictions. Restriction-only changes omit
bindingState so a concurrent disconnect remains effective. Restrictions carry one or more optional typed booleans
(read, triage, draft and send); only supplied fields change, and are forbidden for every other control kind. DispatchNow, RevokeMandate, Forget and Archive require a target.
Control claims are decoded through agent-model's strict RDF mapping, including literal
datatypes, language tags, and cardinalities. Approval claims retain their issued mapping:
`approves` is an IRI; `termsDigest`, `expires`, and `decision` are `xsd:string` literals
without language tags. Both verification and unsigned readers enforce these term shapes.

`readApprovalClaims(document, id)` and `readControlClaims(document, id)` return unsigned
claims or `undefined` for malformed input. They are **display only, never authority**:
they perform no verification and may return expired or tampered claims.
`readControlVerificationMethod(document, id)` returns the key a control's proof names, for
key management (for example, finding statements to re-sign before a key is removed). It is
not authority either: pair it with `verifyControlStatement`.

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

`autonomousTargets(mandate, request, candidates, engine?)` returns sorted, unique
exact autonomous read targets. Pass trusted agent, action, time and attributes;
only `read` (or its full ODRL IRI) is accepted. Attributes are snapshotted once
before evaluation. An absent mandate, non-scalar
purpose, approval-only grant, prohibition or invalid validity/agent binding yields
no target. Each exact-target permission must itself pass evaluation: an
untargeted grant cannot bypass its constraints. Wildcard targets are refused; asset collections
are never expanded. This projects scope only from an already verified mandate.

`createPodMandateVerifier({ credentialUrl, ownerWebId, agentId, fetch,
profileFetch?, now? })` is available from the root and `./verify`. `now` is an
optional clock function. The derived sibling `status.ttl` must end in
`/agent/mandates/status.ttl`, otherwise construction throws a fixed TypeError.
Key/profile and status resolvers are recreated for every load.
Each load fetches the exact credential with `Accept: application/trig`, refuses
redirects and failed responses, bounds the streamed body to 256 KiB, and requires
its signed ID to equal the fetched URL. It delegates WebID key control and signed,
confirmed-clear owner-issued status verification to solid-vc and the existing
VC verifier. Failures return undefined without exposing transport/parser details.
Inject scoped fetches; `profileFetch` can keep public WebID resolution separate
from private credential/status access. The helper uses no Node builtins and is
browser-bundleable. Provision credentials and the status list separately.
