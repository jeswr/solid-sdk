---
name: agent-executor
description: Use when working on the single action enforcement point surface in @jeswr/agent-executor.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-executor

Read agent DESIGN §2 / §4.1 and README.md before changing behavior. The root exports
createExecutor, proposalTermsDigest, durable filesystem adapters and the three-attempt
bound. Contracts are in src/types.ts; explicit synthetic fakes live only in ./testing.

Proposers must derive the approval preview from the wire before sealing action terms:
```ts
const wire = await binding.send.render(renderable, binding.carriage);
proposal.renderedPreview = await binding.send.preview(wire);
const entry = { proposal, renderable, account, wire, wireDigest: wire.digest };
proposal.intent.termsDigest = proposalTermsDigest(entry);
```
The executor compares that preview byte for byte after wire validation and before
mandate/approval work on every attempt, retry, resend and pre-dispatch re-evaluation.
Mismatch or parser exception means refused(preview-mismatch), with the same
tamper-suspected and decision audit handling as wire-mismatch. Never substitute a
free-text summary, HTML alternative or renderable-derived preview. Email includes
To, Subject and decoded text/plain with footer (CRLF to LF only). Matrix uses body;
Teams joins card text blocks; Mastodon uses status; Discord includes content and
embed footer. Direct's native envelope has no visible text and previews as empty.
Preserve uncertain obligations when refusing a resend. Preview parsers must be pure,
bounded, hostile-input hardened and throw ChannelParseError on refusal.

Preserve the nine-step order and fail closed. Halt precedes proposal/mandate reads;
proposal state never grants authority. Re-evaluate every queued item on control/mandate
change, and recheck authority after asynchronous lookup/token waits. Supply the
required synchronous io.assertAuthority fence to bindings: it checks the shared
revision and latest authority deadlines through the request-local beforeDispatch hook,
after all binding and transport awaits (including inner DNS and body buffering),
immediately before underlying fetch/delivery with no intervening await. Pre-delivery gate refusals
settle as not-sent; preserve prior resend uncertainty and acknowledgements for
requests already issued. The host must call
onApprovalChange for every detected approval-store change to invalidate in-flight snapshots
and re-evaluate queued items. Only verified owner
approvals and controls enter their adapter seams. Exact wire and all action terms are
approval-bound; a normal approval cannot override a prohibition or hard limit.

Accounting and claims share a store-wide lock; attempting/uncertain committed amounts
count as spent over the union of outbox and ledger. Require a signed currency for spend
limits; do not guess it to work around the stacked mandate API's missing fields.

Persist attempting with fsync before the provider call. A crash is uncertainty, never
absence. Only positive exact-wire lookup reconciles delivery. Reattempt unresolved
requests only with causal finalAbsence, or identical A2A receiver-deduplicated resend,
max three attempts. A timeout does not cancel the original request. Preserve positive
sent evidence against late failures. The host must hold a single-writer process lease.
Recognize the channel's actual ProviderRejectedError and SendNotDispatchedError classes
(send-only provider/send export), never their names or messages. The latter proves a
local refusal before an effectful send dispatch and preserves the original cause;
read-only preflight does not create send uncertainty. Provider response parse failures
after send dispatch remain uncertain. Settle it as rejected without storing provider text;
unresolved resends retain their earlier commitment. Bound and validate real binding
reference shapes on both acknowledgement and positive lookup paths.

Filesystem operations are injected to preserve the agent layer import boundary. Do not
add raw provider/network/model access or expose a read token through the send projection.
Audit entries contain digests and references, never message bodies, tokens or provider
error text. Surface durability/audit failures; never treat missing audit reads as zero use.

Follow ADR-001 D4: Node >=24, ESM exports, workspace dependencies, strict TypeScript,
Biome, and Vitest. Maintain 100% per-file branches/functions/lines/statements coverage,
including actual durable crash/restart and adversarial asynchronous cases.

Never use live providers or credentials in tests. Send implementations belong exclusively
in channel send subpaths, importable only by agent-executor and channel tests. Only
agent-model-gateway may import OpenAI or Anthropic SDKs; it must never import agent-audit.
