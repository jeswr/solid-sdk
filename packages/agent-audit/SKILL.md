---
name: agent-audit
description: Use when working on the system-written audit ledger surface in @jeswr/agent-audit.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-audit

Read agent DESIGN §2 / §5 and README.md before changing this security-critical API.
The root exports the bounded local ledger, PROV mirror, reader, auditor CLI and
A-045 task statistics (verify retained evidence before exporting body-free counts);
`./verify` is the pure browser-safe API for shared record schemas/types, `seal`,
`checkedRecord`, `parseAuditEntry`, `parseAuditHead` / `auditHeadSchema`,
`verifyLedger`, `verifyRange` and `verifyLatestRange`, plus kinds, bounds and scope
constants. Keep its entire runtime import graph free of Node builtins, fs,
process and Buffer; use `TextEncoder` for the 64 KiB UTF-8 record bound.
`writeEntryGraph` and `writeHeadGraph` share the daemon's exact PROV projection
through caller-supplied `AuditProjectionNode` wrappers, without importing RDF
parsers or n3. Reuse these writers in browser adapters; never copy the projection.
Node consumers must reuse it. Never duplicate validation in an app adapter.
Full retained ledgers require genesis or a matching checkpoint; explicit fetched
ranges verify only their supplied prefix. Latest nonempty ranges require a
published head; historical ranges pass an explicit `through` endpoint. Preserve
both scopes and never sort inputs before verification. Apps retain pod I/O,
exact PROV projection checks and UI shaping. Keep the compiled import-graph and
Node-global-free smoke tests passing.

`./testing` contains the conditional anonymous in-memory resource fixture.
Aggregate unassigned legacy records separately, including counter validation, instead
of dropping their measurements. JSON exposes unassigned counters and CSV uses an
empty-task summary row; never infer a task from model-selected proposal references.

Use one FileLedger writer per path. Preserve fsync-before-prune checkpoints, canonical
hashes, detached snapshots and integrity checks before append. Never accept arbitrary
record payloads: bodies and prompts stay outside the ledger and mirror. Recipients must
be salted, account-bound hashes. Pod writes use injected ADR-003-compatible fetch,
immutable conditional entry creation and ETag-conditional head updates; failures reject.

The auditor re-runs agent-mandate verification, policy evaluation per recipient and
approval verification. Missing/ambiguous PROV, unknown status, unknown accounting,
forged/reused/missing approvals and unsupported scope fail closed. Require a separate
fresh approval even when the policy's autonomous set matches. Default requests are
anonymous, DNS-pinned and refuse redirects; never widen grants or substitute trace
claims for public-key/controller or revocation verification. Report historical-status
and tail-completeness limits honestly. Use only generated synthetic keys and injected
I/O in tests; the CSS fixture must remain loopback-only and memory-backed.

Follow ADR-001 D4: Node >=24, ESM exports, workspace dependencies, strict TypeScript,
Biome, and Vitest. Maintain 100% branches/functions/lines/statements coverage.

Never use live providers or credentials in tests. Future fake implementations belong
in `./testing`. Send implementations belong exclusively in channel send subpaths,
importable only by agent-executor and channel tests. Only agent-model-gateway may
import OpenAI or Anthropic SDKs; the gateway must never import agent-audit.

`personal-data-read` is appended to `ENTRY_KINDS`. It requires `tool`, `decision`,
`reason`, `categories` (1 to 64 IRIs, also for refusals) and `resources` (at most
100 IRIs; empty for refusals or empty results), and accepts an optional purpose IRI. These three metadata fields are forbidden on other record
kinds. Unknown fields, arguments, results and personal-data values remain
forbidden. Its RDF projection uses `dpv:hasPurpose`, `dpv:hasPersonalData` and
`prov:used` through the existing typed writer. `auditArtifact` and task statistics
verify chain integrity but otherwise ignore this kind entirely.

`new PodChain(fetch, baseContainerUrl).append(record, at)` allocates entries
directly in an existing pod container whose URL must end with `/`. Calls on one
instance serialize. Each attempt reads `chain.ttl`, seals the next sequence using
the existing canonical hash, creates `<seq>.ttl` with `If-None-Match: *`, then
publishes its head with `If-Match` and a strong ETag (or `If-None-Match: *` for
genesis). A colliding immutable entry is checked for schema, exact RDF projection,
predecessor and hash before helping publish it and retrying the caller's append.
Appends are at-least-once: a rejected append may still have landed its entry, which
the next writer folds into the chain, so a caller retry can record an event twice
(over-recording is the safe direction). Entries are hashed, not signed: chain
integrity holds only against parties without write access to the container.
A normal append checks the head's structure and the immediate predecessor link but
does not re-verify the whole published prefix (that costs one GET per entry); run
`loadChain` to verify the full chain.
This heals an interrupted entry creation and supports concurrent writers. A
writer whose entry another writer published returns that entry after verifying
the published chain. Five attempts bound contention. Corrupt collisions fail with
`Audit chain integrity failure`; redirects and transport failures use fixed
messages. Provision the container and owner-private ACL separately.
`loadChain(fetch, baseContainerUrl)` verifies the complete published prefix at an
explicit base; `loadTrace` uses the same reader at the conventional audit path.
Hash integrity still requires an independently trusted head to detect rewritten
history or tail truncation.
