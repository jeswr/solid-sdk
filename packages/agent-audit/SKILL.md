---
name: agent-audit
description: Use when working on the system-written audit ledger surface in @jeswr/agent-audit.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-audit

Read agent DESIGN §2 / §5 and README.md before changing this security-critical API.
The root exports the bounded local ledger, PROV mirror, reader and auditor CLI;
`./testing` contains the conditional anonymous in-memory resource fixture.

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
