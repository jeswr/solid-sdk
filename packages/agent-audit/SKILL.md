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
