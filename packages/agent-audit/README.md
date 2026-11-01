<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-audit

> Experimental — AI-agent-generated. Private agent-layer package (A-010 / sst-bda).

The runtime writes an append-only SHA-256 JSONL ledger and mirrors a body-free PROV
projection into the owner's pod. The auditor independently checks that projection,
the hash chain, the signed mandate and the signed approval for each transmission.
There is no model, credential store or send capability in this package.

```ts
import { AuditWriter, FileLedger, PodMirror } from '@jeswr/agent-audit';

// The private directory must already exist. One writer owns each ledger path.
const ledger = new FileLedger('/private/runtime/ledger/events.jsonl');
const mirror = new PodMirror(storageFetch, 'https://pod.example/alice/');
const audit = new AuditWriter(ledger, mirror);
await audit.append({
  type: 'ingest', id: 'urn:uuid:synthetic-event',
  agent: 'https://pod.example/alice/profile/agent#me',
  owner: 'https://pod.example/alice/profile/card#me',
  messageDigest: 'sha-256:' + 'a'.repeat(64),
}, new Date().toISOString());
```

`storageFetch` has the ADR-003 `AuthFetch` signature: inject the runtime's scoped
authenticated transport, or an anonymous fixture. No storage backend is imported.
Only the executor and daemon lifecycle may call the writer; the layer guard bars
the model gateway from importing this package. Await append before continuing an
enforcement path. If mirroring fails, append rejects and local evidence remains.
Retry `mirror.sync(ledger.entries())` before proceeding; don't repeat the local
append for the same event. Calls on one writer/mirror are serialized.

`FileLedger` fsyncs each line and its initial directory entry, rotates at
`segmentMaxEntries` (default 5,000; minimum 2), and keeps `maxSegments` archived
segments (default 40; minimum 1). Before pruning it fsyncs a `ledger-checkpoint`
with the removed prefix's sequence and hash. It validates retained storage on
open and before every append. Retention policy and archival are deployment
decisions; mirror before pruning to preserve the complete pod prefix.
`MemoryLedger` returns detached snapshots and is intended for ephemeral use.

Records accept only the DESIGN §5 kinds: `ingest`, `proposal`, `decision`,
`approval-seen`, `transmission`, `receipt`, `control`, `mandate-change`,
`model-call`, `tamper-suspected`, plus internal `ledger-checkpoint` records.
Unknown fields, bodies, prompt text, raw recipient arrays, malformed timestamps,
non-JSON values and oversized records are rejected. Records are capped at 64 KiB.
`model-call` accepts identifiers, provider/context and numeric counts only.
Use `hashRecipient(handle, accountId, salt)` with a secret random salt of at least
32 bytes, retained only in the private runtime store. Hashes are account-bound
HMAC-SHA-256 (`sha256:<hex>`), matching agent-mandate's recipient vocabulary.

For a complete proposal audit, write these linked events in order:

- `proposal`: `id`, `agent`, `owner`, `terms` and `termsDigest`.
- `decision`: a distinct `id`, the same `proposal`, `mandate`, identities, terms
  and digest, and the decision returned by `evaluateIntent`.
- `approval-seen`: a distinct event `id`, the `proposal`, identities and the
  signed `approval` document IRI.
- `transmission`: a distinct `id`, the same terms, identities, proposal and
  mandate, `decisionRecord` naming the exact decision, `approval`, and `status`.
- `receipt`: a distinct `id`, identities, `proposal`, and `transmission` IRI.

`AuditTerms` contain action/target IRIs, binding, opaque account ID, salted
recipient hashes, the message digest, optional purpose IRI and optional
`proposalDigest`. Executor-backed records use `proposalApprovalTerms(entry)` from
agent-executor, whose `proposalDigest` commits the full private intent, carrier,
preview and expiry without exposing them. `termsDigest` is
`digestOf(terms)` from agent-model. This exact body-free digest must be signed by
agent-mandate's `issueApproval`. The full message stays in the private inbox;
audit accepts its digest only. An uncertain/unsent transmission or absent receipt
is an incomplete walk and cannot produce a clean audit.

Each immutable `agent/audit/<seq>.ttl` contains a `prov:Activity` at its resource
URL and a generated `prov:Entity` at `#entry`. The activity carries `prov:used`
authority references, `prov:wasAssociatedWith` the executor, the exact canonical
JSON record, sequence, time, `agent:ledgerHash` and `agent:prevHash`; the entity
carries `prov:wasAttributedTo` the owner. Decision
activities also reify request, evaluation time, principal, assignee, policy,
verdict, digest and reason. Typed wrapper accessors construct graphs; n3.Writer
serializes deterministic Turtle. `chain.ttl` is a `prov:Collection` whose head
member is the entry entity; it publishes the head only after the entry succeeds.
Entry creation uses `If-None-Match: *`; head updates require an
ETag. A partial write can be retried, but a different existing entry, stale head,
absent ETag or competing history fails closed. Provision the container and its
owner-selected ACL separately; this package never broadens access.

```sh
pnpm --filter @jeswr/agent-audit run build
node packages/agent-audit/bin/audit.mjs https://pod.example/alice/agent/proposals/1.ttl
node packages/agent-audit/bin/audit.mjs https://pod.example/alice/agent/proposals/1.ttl --at 2026-10-26T12:00:00.000Z
```

The installed binary is `audit`. It derives the storage root from
`/agent/proposals/`, prints the authority chain and named breaches, and exits 0
only for a complete, independently verified walk (otherwise 1). Requests present
no credentials and never fall back to login. The default uses DNS-pinned guarded
fetch; redirects, wrong media types and resources over 1 MiB are refused.
The owner must grant public read to the audit, mandate, approval, status and
WebID key documents for anonymous verification. An auditor-specific private
transport can instead be injected through the library API.

`auditArtifact({ fetch, root, proposal, at?, ownerWebId?, webIdKeyResolver?,
statusResolver? })` exposes the same walk. The optional owner pin is independent
of trace assertions; otherwise the report identifies the verified issuer.
All referenced credential documents stay within the configured pod. WebID and
status resolution use guarded public requests by default; injected transports
must enforce the same SSRF and credential boundaries. Mandate verification is
delegated to agent-mandate, including its agent-authz-verifier integrity,
binding and revocation checks. Unsupported delegated credentials fail closed
under that package's existing verifier; this package introduces no new grant
format. Each recipient is evaluated separately. A separate verified, unexpired
approval is required for every send, even for an autonomous policy match; reuse,
denial, missing observations and mismatched terms fail. Limits requiring runtime
accounting produce `accounting-unverified`, since the trace alone cannot prove
spend/rate balances. `--at` re-runs authorization and approval validity at that
instant; otherwise each transmission's instant is used. A current status list
cannot establish historical status by itself: historical deployments must inject
an authoritative time-indexed resolver. Unknown status never grants authority.

Hash chains prove consistency of the entries present, not completeness or
authorship. Missing middle entries, modifications and reordering are detected;
unrecorded events, a rewritten entire history and tail truncation need an
independently trusted head or archive to detect. A retained checkpoint attests
pruning without proving the deleted content. The pod reader verifies the complete
published prefix (maximum 200,000 entries); a missing prefix fails closed.

`./testing` exports `createMemoryAuditPod`, an anonymous resource fixture with
conditional PUTs. Tests also use a loopback-only, memory-backed CSS 7.2.0 server
and generated synthetic keys: intact chain → 0; forged approval, out-of-scope,
revoked and missing PROV → 1. Golden Turtle and tamper/recovery tests run with
100% per-file branch/function/line/statement thresholds.

Sources: the imported pilot's `store/ledger.ts`, and accountable-agent-runtime's
[writer](https://github.com/jeswr/accountable-agent-runtime/blob/main/src/trace/writer.ts),
[reader](https://github.com/jeswr/accountable-agent-runtime/blob/main/src/trace/reader.ts),
and [decision record](https://github.com/jeswr/accountable-agent-runtime/blob/main/src/trace/decision-record.ts),
retargeted to DESIGN §5 and agent-mandate without copying its engagement-specific
WAC mutation or send paths.

Run this package's `lint`, `build`, `typecheck` and `test` scripts. CSS and
Components.js are development-only fixtures; production dependencies reuse
existing workspace verification, canonical JSON and RDF libraries.
