<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/agent-reference

The reference agent runtime of the accountable agent architecture. It is the September
pilot runtime, lifted out of `@jeswr/personal-agent/pilot` without changes:

- `core/` — the transport-neutral message model, conversation state machine, limits, schema
- `mechanisms/` — JWS signing, pinned trust store, owner mandates over an ODRL subset,
  signed statements, policy engines
- `profile/` — configurations, implementation descriptions, vocabulary
- `runtime/` — the agent runtime (inbound pipeline, executor, transmission, retention)
- `store/` — state stores and the hash-chained ledger
- `bindings/direct` — the in-process direct binding
- `domains/`, `fixtures/`, `scenarios/` — the synthetic mortgage flow and what it needs
  (purpose-bound store, scheduling payment operation, mandates)

`@jeswr/personal-agent/pilot` re-exports every moved module from its old path, so existing
callers and tests are unchanged. Each module is reachable by path, for example
`@jeswr/agent-reference/runtime/agent`.

## Gates, suites and traces

- `suites/` — `SuiteRegistry`: one interface per layer (ids from the explorer model),
  `Configuration` (one suite per layer) with `check()`, and `baselineRegistry()` holding the
  baseline suites and the `BASELINE` configuration. A message declares exactly one
  configuration; `settle()` matches configurations whole, never layer by layer.
- `gates/inbound` — `InboundGate` and `Admission`: integrity, source, authority, terms,
  fitness, then admit or refuse. `gates/outbound` — `OutboundGate.release()`: mandate,
  recipient, disclosure, data terms, limits and approval, then `seal()` for evidence; go,
  ask the principal, or stop. The runtime calls them where the pilot already decided, so
  `@jeswr/personal-agent` behaves as before when no `gates` option is given.
- `trust/resolver` — `TrustResolver`: own list, then a root, then the register it delegates
  to; every answer carries its path.
- `trace/` — the `agent-trace/0.1` types, `TraceRecorder`, packet views and `outlineOf()`.
- `reference/` — reproducible runs (fixed test keys, deterministic ids, fixed clock,
  scripted core) of the mortgage flow and its branches.

`pnpm run build` writes every trace to `traces/<scenario>--<configuration>.json` (plus
`traces/index.json`). Expected outlines are committed in `outlines/`; a test fails when a
run departs from them. After an intended change, run `node scripts/update-outlines.mjs`
and review the diff.

Trace format extensions beyond the brief: `outcome` on decision events, `resolution` on
trust lookups, `fact` on memory events, and gate codes (`not-in-configuration`,
`no-claims`, `no-action-intent`, `conversation-bound`, `not-yet-agreed`,
`no-register-for-party`, `no-personal-data`) as the reason of `not-applicable` verdicts.

Experimental. Synthetic parties and data only; both sides of every exchange run this code.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Executable use cases live in `profiles/<id>.json` and `scenarios/<id>.json`. The validators
and published JSON Schemas are `engine/schema` and `schemas/`. `runScenarioPaths(profile,
scenario)` runs the main path and each named branch through the real runtime, gates, trust
resolver and suite registry, and rejects any outline mismatch. `generateTraces` writes all
paths. Expected outlines are assertions, never instructions to the gates.

A profile declares claim sources, accepted methods and freshness, purpose needs, derived
rules and accepted assurances, person decisions, and permitted reading steps. The scenario
supplies fictional parties, public pinned keys and register lists, signed-mandate payloads,
source-statement payloads, and scripted core proposals. `runs: "issuer-only"` never starts
an agent. Public deterministic test-key labels are re-derived and statements are signed on
each run. No credential store, provider, model, network service or real payment is used.

`core` supplies an ordered list of responses for each protocol hook; `script` calls the
runtime and routes returned wires using `{"$ref":"call-id.outbound.0.wire"}`. Signed source
content uses `{"$statement":"statement-id"}`; hook replies may refer to their actual inputs
with `{"$context":"0.conversation.id"}`. Scripts cannot invoke arbitrary runtime methods.
Branch `changes` are JSON-pointer replacements in the world or script, and `expect` is the
full expected outline for that path. `inject` patches a received wire at a specified step
without re-signing it, so altered messages are checked by the integrity gate.

Profiles also supply JSON Schemas for each operation's terms or input. Hooks may pin their
expected inputs with `input`; a different input fails the run rather than reusing an answer
prepared for another request. Commands cannot move the clock or step labels backwards.
Claim sources, methods and freshness compile into each party's trust and reliance inputs.
Purpose claim lists govern context disclosure, `personDecisions` names operations requiring
a person, and `readingSteps` limits where a model reading may be used. Derived-rule and
assurance declarations are checked; unconnected computation and proof systems fail explicitly
instead of being represented by a scripted answer or signature.

A proposed action can carry `freeText: { text }`. The runtime binds its current task context
digest into the action before evaluating it, requesting approval, or signing the message.
The signed envelope marks the text as model-written, names the principal and purpose, and
carries the text digest. Text never supplies structured offer, acceptance, payment or consent
fields. Unstructured protocol prose without an authorised intent stops before entering the
outbox; the injected-fee scenario models hostile sender content at the receiving boundary.

`admitStatements(..., { taskId, task, purpose })` and `recallForTask(taskId, ids)` track the
statements recalled into a task. Incoming messages, verified statements and memory reads
are tracked when they reach the core. Context labels survive restart and cannot be erased by
the core. A restricted or unknown context gives `ask-principal/context-not-clear` when the
mandate allows approval, otherwise a stop. The principal sees the exact text; adding context
changes the action digest and prevents reuse of an earlier approval. `recordReading` records
and signs a new statement by the reading agent with `method: model-output`, the original
content digest, inherited terms, and a reference to its signed program/tool declaration.

The mortgage scripts preserve the existing committed outlines. The personal-agent pilot
keeps its original domain handlers locally for compatibility; the reference engine has no
domain-specific handlers. A scripted answer is a core proposal, not evidence of a live
proof, joint computation, or a real institutional decision.
