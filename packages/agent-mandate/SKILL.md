---
name: agent-mandate
description: Use when issuing or verifying owner mandates and approvals, evaluating ODRL policy sets, importing pilot JWS mandates, or adapting the policy-engine seam in @jeswr/agent-mandate.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-mandate

Read README.md and agent DESIGN D3 / §4.2 before changing this security-critical surface.
The public interfaces are in src/types.ts, src/mandate.ts, src/approval.ts and src/control.ts;
./testing contains explicit in-memory fakes. The optional Node-only sparq binary adapter is ./sparq.

Use `issueMandate` with Ed25519 (default) or explicit `ecdsa-rdfc-2019` for a non-extractable
browser P-256 key, and a mandatory revocation status entry. Policies are embedded
in the signed credential graph. `mandateToTurtle` (historical name) / `parseMandateCredential`
transport the package-issued dataset losslessly as TriG (`application/trig`). Approvals use
the same transport. Proofs occupy named graphs and proofValue is a sec:multibase literal,
matching the standard Data Integrity context. Parsing is structural, so always run
`createVcMandateVerifier`.
The WebID key resolver and status resolver are mandatory injected seams. Never substitute
a verification method prefix heuristic or use a key supplied inside the document.

Only a mandate that passes integrity, owner/agent binding, validity and confirmed-clear status
may reach PolicyEngine. Undefined means refuse-all. Expired/future/wrong-agent mandates refuse
all authority. Any prohibition wins in every set, including against a broader requested action
that covers the prohibited one. A set-valued operand under an isAnyOf permission constraint (or an isAllOf one with an
unlisted value),
missing context, unknown vocabulary, duties,
engine failure and no matching rule require confirmation. A permit in withApproval still
requires a separate verified approval. Accounting and transmissions belong to agent-executor.

Approval checks are ordered: exact ecdsa-rdfc-2019 suite / assertion purpose; WebID assertionMethod
and P-256 key; RDFC signature; proposal IRI; constant-work digest comparison; expiry using the
injected clock; approve/deny decision. Keep non-extractable key support. Browser signing uses
the ./approval and ./control subpaths with solid-vc's WebCrypto hashing and browser bundle.
`src/mandate.ts` must also bundle for browsers without Node builtins. Only `./sparq` is Node-only.
Control statements use the agent-model vocabulary and require the same suite/key/signature
checks, then exact owner attribution and expiry. Claim readers are display only, never
authority. Do not implement alternate crypto here.

Legacy OwnerMandate JWS is import-only. Trust locally pinned keys, reject embedded keys and
unexpected headers, enforce the pilot subset and require an injected revocation check.
The test-only fixture generator must never persist private keys.

RDF reads/writes use typed @rdfjs/wrapper accessors; parsing uses @jeswr/fetch-rdf and serialization
uses n3.Writer. Canonicalization and proof operations use @jeswr/solid-vc. All tests and scripts
use synthetic example identities, generated test keys and injected I/O; never call live providers.

Maintain Node >=24, ESM/workspace dependencies, strict TypeScript, Biome, and 100% per-file
coverage in every metric. Every decision-matrix row must name its expected decision and reason.

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
