---
name: agent-mandate
description: Use when issuing or verifying owner mandates and approvals, evaluating ODRL policy sets, importing pilot JWS mandates, or adapting the policy-engine seam in @jeswr/agent-mandate.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-mandate

Read README.md and agent DESIGN D3 / §4.2 before changing this security-critical surface.
The public interfaces are in src/types.ts, src/mandate.ts and src/approval.ts; ./testing
contains explicit in-memory fakes. The optional Node-only sparq binary adapter is ./sparq.

Use `issueMandate` with Ed25519 and a mandatory revocation status entry. Policies are embedded
in the signed credential graph. `mandateToTurtle` (historical name) / `parseMandateCredential`
transport the package-issued dataset losslessly as TriG (`application/trig`). Approvals use
the same transport. Proofs occupy named graphs and proofValue is a sec:multibase literal,
matching the standard Data Integrity context. Parsing is structural, so always run
`createVcMandateVerifier`.
The WebID key resolver and status resolver are mandatory injected seams. Never substitute
a verification method prefix heuristic or use a key supplied inside the document.

Only a mandate that passes integrity, owner/agent binding, validity and confirmed-clear status
may reach PolicyEngine. Undefined means refuse-all. Expired/future/wrong-agent mandates refuse
all authority. Any prohibition wins in every set. Missing context, unknown vocabulary, duties,
engine failure and no matching rule require confirmation. A permit in withApproval still
requires a separate verified approval. Accounting and transmissions belong to agent-executor.

Approval checks are ordered: exact ecdsa-rdfc-2019 suite / assertion purpose; WebID assertionMethod
and P-256 key; RDFC signature; proposal IRI; constant-work digest comparison; expiry using the
injected clock; approve/deny decision. Keep non-extractable key support. Native browser issuance
is currently blocked by solid-vc's node:crypto hashing; do not claim browser integration without
fixing and verifying that upstream dependency. Do not implement alternate crypto here.

Legacy OwnerMandate JWS is import-only. Trust locally pinned keys, reject embedded keys and
unexpected headers, enforce the pilot subset and require an injected revocation check.
The test-only fixture generator must never persist private keys.

RDF reads/writes use typed @rdfjs/wrapper accessors; parsing uses @jeswr/fetch-rdf and serialization
uses n3.Writer. Canonicalization and proof operations use @jeswr/solid-vc. All tests and scripts
use synthetic example identities, generated test keys and injected I/O; never call live providers.

Maintain Node >=24, ESM/workspace dependencies, strict TypeScript, Biome, and 100% per-file
coverage in every metric. Every decision-matrix row must name its expected decision and reason.
